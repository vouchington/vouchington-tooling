import { EventEmitter } from 'node:events'
import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { createTestPostgresLockWaiter, type TestLockWaiterHolder } from './index.mts'

const SESSION_SETTINGS = {
  process_id: 9001,
  version: 180001,
  role_name: 'tester',
  database_name: 'testdb',
  locale: 'C',
  log_lock_waits: 'off',
  deadlock_timeout: '1s',
  client_min_messages: 'notice',
  statement_timeout: '2s',
  application_name: 'test',
  timeout_ms: 2000,
  can_log: true,
  can_set_deadlock: true,
}

function createFakeNoticeClient(
  options: {
    closeFails?: boolean
    keepPendingQuery?: boolean
  } = {},
) {
  const emitter = new EventEmitter()
  const release = vi.fn((err?: Error) => {
    if (err) queueMicrotask(() => emitter.emit('end'))
  })
  const query = vi.fn(async (input: string | { text: string; values?: unknown[] }) => {
    const text = typeof input === 'string' ? input : input.text
    if (text.includes('observePostgresLockNotice.settings')) {
      return { rows: [SESSION_SETTINGS] }
    }
    if (text.includes('observePostgresLockNotice.restore')) {
      if (options.closeFails) throw new Error('restore settings failed')
      return { rows: [SESSION_SETTINGS] }
    }
    if (options.keepPendingQuery && text.includes('/* target */')) {
      return await new Promise<never>(() => {})
    }
    return { rows: [] }
  })
  const client = Object.assign(emitter, { query, release })
  return { client: client as unknown as pg.PoolClient, emitter, release, query }
}

function createHolder(
  rows: Record<string, unknown>[],
  releaseImpl?: () => Promise<void>,
): TestLockWaiterHolder {
  return {
    query: vi.fn(async () => ({ rows })) as TestLockWaiterHolder['query'],
    release: vi.fn(releaseImpl ?? (async () => undefined)),
  }
}

describe('createTestPostgresLockWaiter', () => {
  it('observes a transaction lock wait and cleans up on async disposal', async () => {
    const { client, emitter, release, query } = createFakeNoticeClient()
    const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool
    const holder = createHolder([{ transaction_id: '777' }])
    const txDispose = vi.fn(async () => undefined)
    let resolveTarget!: () => void
    ;(client as unknown as { query: unknown }).query = (
      input: string | { text: string; values?: unknown[] },
      values?: unknown[],
    ) => {
      if (typeof input === 'object' && input.text.includes('/* target */')) {
        return new Promise<{ rows: [] }>((resolve) => {
          resolveTarget = () => resolve({ rows: [] })
        })
      }
      return (query as (i: unknown, v?: unknown) => Promise<unknown>)(input, values)
    }

    const tx = {
      run: () => client.query({ text: '/* target */ SELECT 1', values: ['row-1'] }),
      [Symbol.asyncDispose]: txDispose,
    }

    const waiter = await createTestPostgresLockWaiter({
      pool,
      holder,
      beginTransaction: async () => tx,
      lock: { kind: 'transaction' },
      selected: { marker: '/* target */', binding: { index: 0, value: 'row-1' } },
      notice: { applicationNamePrefix: 'test-lock' },
    })

    const queryPromise = tx.run()
    let resolveAction!: () => void
    const action = new Promise<void>((resolve) => {
      resolveAction = resolve
    })
    const waitPromise = waiter.waitForLock(action)
    expect(() => waiter.waitForLock(action)).toThrow('accepts one live action')

    emitter.emit('notice', {
      message: 'process 9001 still waiting for ShareLock on transaction 777 after 1.000 ms',
    })
    await waitPromise
    resolveTarget()
    await queryPromise
    resolveAction()
    await waiter[Symbol.asyncDispose]()
    expect(holder.release).toHaveBeenCalledOnce()
    expect(txDispose).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledWith(undefined)
  })

  it('observes advisory32 and advisory64 lock tags and rejects missing or ambiguous holder locks', async () => {
    for (const kind of ['advisory32', 'advisory64'] as const) {
      const { client } = createFakeNoticeClient()
      const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool
      const holder = createHolder([{ lock_tag: 'advisory lock [1,2,3,1]' }])
      const waiter = await createTestPostgresLockWaiter({
        pool,
        holder,
        beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
        lock: { kind, key: 'lock-key' },
        selected: { marker: '/* adv */', binding: { index: 0, value: 'k' } },
      })
      await waiter[Symbol.asyncDispose]()
      expect(() => waiter.waitForLock(Promise.resolve())).toThrow('accepts one live action')
    }

    const emptyPool = { connect: vi.fn() } as unknown as pg.Pool
    await expect(
      createTestPostgresLockWaiter({
        pool: emptyPool,
        holder: createHolder([]),
        beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
        lock: { kind: 'transaction' },
        selected: { marker: '/* m */', binding: { index: 0, value: 'v' } },
      }),
    ).rejects.toThrow('Owned holder has no PostgreSQL transaction ID')

    await expect(
      createTestPostgresLockWaiter({
        pool: emptyPool,
        holder: createHolder([
          { lock_tag: 'advisory lock [1,2,3,1]' },
          { lock_tag: 'advisory lock [1,2,3,1]' },
        ]),
        beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
        lock: { kind: 'advisory64', key: 'dup' },
        selected: { marker: '/* m */', binding: { index: 0, value: 'v' } },
      }),
    ).rejects.toThrow('Owned holder does not have the exact advisory lock')
  })

  it('aggregates cleanup failures with primary setup failure or rejected action and destroys client', async () => {
    const failConnectPool = {
      connect: vi.fn(async () => {
        throw new Error('connect boom')
      }),
    } as unknown as pg.Pool
    const failingHolder = createHolder([{ transaction_id: '55' }], async () => {
      throw new Error('holder release boom')
    })
    await expect(
      createTestPostgresLockWaiter({
        pool: failConnectPool,
        holder: failingHolder,
        beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
        lock: { kind: 'transaction' },
        selected: { marker: '/* m */', binding: { index: 0, value: 'v' } },
      }),
    ).rejects.toThrow('Owned PostgreSQL waiter cleanup failed')

    const { client, emitter, release } = createFakeNoticeClient({
      closeFails: true,
      keepPendingQuery: true,
    })
    const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool
    const holder = createHolder([{ transaction_id: '88' }])
    const waiter = await createTestPostgresLockWaiter({
      pool,
      holder,
      beginTransaction: async () => ({
        [Symbol.asyncDispose]: async () => {
          throw new Error('tx dispose boom')
        },
      }),
      lock: { kind: 'transaction' },
      selected: { marker: '/* target */', binding: { index: 0, value: 'v' } },
    })

    void client.query({ text: '/* target */ SELECT 1', values: ['v'] })
    const rejectedAction = Promise.reject(new Error('action boom'))
    void rejectedAction.catch(() => undefined)
    const waiting = waiter.waitForLock(rejectedAction)
    emitter.emit('notice', {
      message: 'process 9001 still waiting for ShareLock on transaction 88 after 1.000 ms',
    })
    await waiting.catch(() => undefined)

    await expect(waiter[Symbol.asyncDispose]()).rejects.toThrow(
      'Owned PostgreSQL waiter cleanup failed',
    )
    expect(release).toHaveBeenCalledWith(expect.any(AggregateError))
  })

  it('aborts setup when cleanup runs mid-setup via registerCleanup', async () => {
    const { client } = createFakeNoticeClient()
    let releaseConnect!: () => void
    const pool = {
      connect: vi.fn(
        () =>
          new Promise<pg.PoolClient>((resolve) => {
            releaseConnect = () => resolve(client)
          }),
      ),
    } as unknown as pg.Pool
    let registeredCleanup!: () => Promise<void> | undefined
    const holder = createHolder([{ transaction_id: '99' }])

    const creating = createTestPostgresLockWaiter({
      pool,
      holder,
      beginTransaction: async () => ({ [Symbol.asyncDispose]: async () => undefined }),
      lock: { kind: 'transaction' },
      selected: { marker: '/* target */', binding: { index: 0, value: 'v' } },
      registerCleanup: (fn) => {
        registeredCleanup = fn
      },
    })
    // Wait until pool.connect() has been invoked.
    await Promise.resolve()
    await Promise.resolve()
    const cleanupPromise = registeredCleanup()
    releaseConnect()
    await cleanupPromise
    await expect(creating).rejects.toThrow('Owned PostgreSQL waiter is already closed')
  })
})
