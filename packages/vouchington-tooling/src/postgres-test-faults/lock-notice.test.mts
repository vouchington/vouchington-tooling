import { EventEmitter } from 'node:events'
import type { QueryResult } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import {
  observePostgresLockNotice,
  observeTestAdvisoryLockNotice,
  observeTestTransactionLockNotice,
  type LockNoticeClient,
} from './lock-notice.mts'

type Row = Record<string, unknown>

function createSession(overrides: Row = {}) {
  const settings = {
    process_id: 12345,
    version: 180006,
    can_log: true,
    can_set_deadlock: true,
    locale: 'C',
    log_lock_waits: 'off',
    deadlock_timeout: '1s',
    client_min_messages: 'warning',
    statement_timeout: '5s',
    application_name: 'owned-lock-test',
    timeout_ms: 5000,
    role_name: 'restricted-test-role',
    database_name: 'owned-test-db',
    ...overrides,
  }
  const result = {
    rows: [settings],
    fields: [],
    command: 'SELECT',
    oid: 0,
    rowCount: 1,
  } satisfies QueryResult<typeof settings>
  const query = vi
    .fn<(text: string, values?: unknown[]) => Promise<unknown>>()
    .mockResolvedValueOnce(result)
    .mockRejectedValue(new Error('permission denied to set parameter "log_lock_waits"'))
  const client = Object.assign(new EventEmitter(), { query }) as unknown as LockNoticeClient &
    EventEmitter
  return { client, query, settings, result }
}

describe('lock-observer prerequisites', () => {
  it.each([
    { version: 170006 },
    { version: 190000 },
    { can_log: false },
    { can_set_deadlock: false },
  ])('keeps the prerequisite error for %j', async (overrides) => {
    const { client, query, settings } = createSession(overrides)
    const observer = observeTestAdvisoryLockNotice(client, 'owned-lock', {
      setupHint: 'Start a disposable database first.',
    })
    try {
      await expect(observer.ready).rejects.toThrow(
        `server_version_num=${settings.version}, current_user=${settings.role_name}, current_database()=${settings.database_name}, can_log=${overrides.can_log ?? true}, can_set_deadlock=${overrides.can_set_deadlock ?? true}`,
      )
      await expect(observer.ready).rejects.toThrow('Start a disposable database first.')
    } finally {
      await expect(observer.close()).resolves.toBeUndefined()
    }
    expect(query).toHaveBeenCalledTimes(1)
    expect(client.listenerCount('notice')).toBe(0)
  })

  it('honors a custom accepted version range without a hint', async () => {
    const { client } = createSession({ version: 170006 })
    const observer = observeTestAdvisoryLockNotice(client, 'owned-lock', {
      serverVersionNum: { min: 170000, max: 180000 },
    })
    await expect(observer.ready).rejects.toThrow('permission denied')
    await observer.close().catch(() => undefined)
  })

  it('rejects non-English notices, a missing row and too little statement-timeout headroom', async () => {
    for (const [overrides, message] of [
      [{ locale: 'de_DE.UTF-8' }, 'normal English PostgreSQL notices'],
      [{ timeout_ms: 500 }, 'insufficient statement-timeout headroom: 500'],
    ] as const) {
      const { client } = createSession(overrides)
      const observer = observeTestAdvisoryLockNotice(client, 'owned-lock')
      await expect(observer.ready).rejects.toThrow(message)
      await observer.close()
    }
    const { client, query } = createSession()
    query.mockReset().mockResolvedValue({ rows: [] })
    const observer = observeTestAdvisoryLockNotice(client, 'owned-lock')
    await expect(observer.ready).rejects.toThrow('did not report its session settings')
    await observer.close()
  })

  it('still restores original settings after configuration fails', async () => {
    const { client, query, settings, result } = createSession()
    const failure = new Error('configuration failed')
    query.mockRejectedValueOnce(failure).mockResolvedValueOnce(result)
    const observer = observeTestAdvisoryLockNotice(client, 'owned-lock')
    await expect(observer.ready).rejects.toBe(failure)
    await expect(observer.close()).resolves.toBeUndefined()
    await observer.close()
    expect(query).toHaveBeenCalledTimes(3)
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      settings.log_lock_waits,
      settings.deadlock_timeout,
      settings.client_min_messages,
      settings.statement_timeout,
      settings.application_name,
    ])
    expect(client.listenerCount('notice')).toBe(0)
  })

  it('fails closing when a setting does not read back as restored', async () => {
    const { client, query, settings, result } = createSession()
    query.mockResolvedValueOnce(result).mockResolvedValueOnce({
      rows: [{ ...settings, deadlock_timeout: '9s' }],
    })
    const observer = observeTestAdvisoryLockNotice(client, 'owned-lock')
    await observer.ready
    await expect(observer.close()).rejects.toThrow('setting was not restored: deadlock_timeout')
  })
})

describe('lock notice waiting', () => {
  async function observe(
    observe: (client: LockNoticeClient) => ReturnType<typeof observePostgresLockNotice>,
  ) {
    const session = createSession()
    session.query
      .mockReset()
      .mockResolvedValueOnce(session.result)
      .mockResolvedValue(session.result)
    const observation = observe(session.client)
    await observation.ready
    return { ...session, observation }
  }
  const noticeFor = (mode: string, tag: string) => ({
    message: `process 12345 still waiting for ${mode} on ${tag} after 100.1 ms`,
  })

  it.each([
    [
      'exclusive advisory',
      (client: LockNoticeClient) =>
        observeTestAdvisoryLockNotice(client, 'advisory lock [1,2,3,1]'),
      'ExclusiveLock',
      'advisory lock [1,2,3,1]',
    ],
    [
      'shared advisory',
      (client: LockNoticeClient) =>
        observeTestAdvisoryLockNotice(client, 'advisory lock [1,2,3,1]', { mode: 'shared' }),
      'ShareLock',
      'advisory lock [1,2,3,1]',
    ],
    [
      'transaction',
      (client: LockNoticeClient) => observeTestTransactionLockNotice(client, '777'),
      'ShareLock',
      'transaction 777',
    ],
  ])('resolves on the native %s notice', async (_name, create, mode, tag) => {
    const { client, observation } = await observe(create)
    const waiting = observation.wait(new Promise(() => undefined))
    client.emit('notice', { message: 'process 99 still waiting for x' })
    client.emit('notice', noticeFor(mode, tag))
    await expect(waiting).resolves.toBeUndefined()
    await observation.close()
  })

  it('ignores a notice while ineligible and uses the configured application name prefix', async () => {
    let eligible = false
    const { client, query, observation } = await observe((c) =>
      observePostgresLockNotice(c, 'relation 1 of database 2', 'AccessShareLock', {
        eligible: () => eligible,
        applicationNamePrefix: 'prefix',
      }),
    )
    expect(query.mock.calls[1]?.[1]).toEqual(['5000', expect.stringMatching(/^prefix-/)])
    let noticed = false
    void observation.wait(new Promise(() => undefined)).then(() => (noticed = true))
    client.emit('notice', noticeFor('AccessShareLock', 'relation 1 of database 2'))
    await Promise.resolve()
    expect(noticed).toBe(false)
    eligible = true
    client.emit('notice', noticeFor('AccessShareLock', 'relation 1 of database 2'))
    await vi.waitFor(() => expect(noticed).toBe(true))
    await observation.close()
  })

  it('propagates the owned action failure or reports that it settled early', async () => {
    const failure = new Error('action failed')
    const { observation } = await observe((c) => observeTestAdvisoryLockNotice(c, 'tag'))
    await expect(
      observation.wait(Promise.resolve([{ status: 'rejected', reason: failure }])),
    ).rejects.toBe(failure)
    await expect(
      observation.wait(Promise.resolve([{ status: 'fulfilled', value: 1 }])),
    ).rejects.toThrow('settled without reaching its lock')
    await observation.close()
  })

  it('caps a long statement timeout and spans an unlimited one', async () => {
    const long = createSession({ timeout_ms: 60_000 })
    const first = observeTestAdvisoryLockNotice(long.client, 'tag')
    await first.ready.catch(() => undefined)
    expect(long.query.mock.calls[1]?.[1]?.[0]).toBe('5000')
    const unlimited = createSession({ timeout_ms: 0 })
    const second = observeTestAdvisoryLockNotice(unlimited.client, 'tag')
    await second.ready.catch(() => undefined)
    expect(unlimited.query.mock.calls[1]?.[1]?.[0]).toBe('5000')
  })
})
