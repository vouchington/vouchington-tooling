import { rmSync } from 'node:fs'
import { chmod, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  classifyFrictionObservation,
  FRICTION_LOG_MAX_EVENTS,
  readFrictionLog,
  recordFriction,
} from './index.mts'
import type { FrictionLogOptions } from './types.mts'

const directories: string[] = []
async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'session-friction-'))
  directories.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((value) => rm(value, { force: true, recursive: true })),
  )
})

describe('classifyFrictionObservation', () => {
  it('prioritizes escalation over a simultaneous failure', () => {
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'rtk git push',
        commandWrappers: ['rtk'],
        escalationDetail: 'sandbox override',
        structuredStderr: 'EPERM',
      }),
    ).toEqual({
      kind: 'sandbox-escalation',
      commandPrefix: 'rtk git push',
      detail: 'sandbox override',
    })
  })

  it('classifies permission requests and structured stderr only', () => {
    expect(
      classifyFrictionObservation({ type: 'permission-request', command: 'pnpm test' }),
    ).toEqual({
      kind: 'sandbox-escalation',
      commandPrefix: 'pnpm test',
      detail: 'permission-request',
    })
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'node test',
        structuredStderr: 'ECONNREFUSED 127.0.0.1',
      }),
    ).toEqual({
      kind: 'sandbox-failure',
      commandPrefix: 'node test',
      detail: 'stderr matched localhost connection failure',
    })
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'node test',
        structuredStderr: 'ECONNREFUSED 127.0.0.2',
      }),
    ).toMatchObject({ kind: 'sandbox-failure' })
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'node test',
        structuredStderr: 'ECONNREFUSED at foo::1 bar',
      }),
    ).toBeNull()
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'node test',
        structuredStderr: 'ECONNREFUSED 127.999.0.1',
      }),
    ).toBeNull()
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'node test',
        structuredStderr: 'connect ECONNREFUSED [::1]:5432',
      }),
    ).toMatchObject({ kind: 'sandbox-failure' })
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'node test',
        structuredStderr: 'connect ECONNREFUSED 0:0:0:0:0:0:0:1%lo0',
      }),
    ).toMatchObject({ kind: 'sandbox-failure' })
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'cat',
        structuredStderr: 'eperm',
      }),
    ).toEqual({
      kind: 'sandbox-failure',
      commandPrefix: 'cat',
      detail: 'stderr matched "EPERM"',
    })
    expect(classifyFrictionObservation({ type: 'tool-result', command: 'rg EPERM' })).toBeNull()
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'git push',
        escalationDetail: 'safe\u202ereversed\u202c',
      }),
    ).toMatchObject({ detail: 'safe reversed' })
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'curl remote',
        structuredStderr: 'connect ECONNREFUSED 10.0.0.5:5432',
      }),
    ).toBeNull()
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'curl remote',
        structuredStderr: 'connect ECONNREFUSED 10.0.0.5:5432\nunrelated localhost note',
      }),
    ).toBeNull()
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'curl remote',
        structuredStderr: 'connect ECONNREFUSED [2001:db8::1]:5432',
      }),
    ).toBeNull()
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'echo',
        structuredStderr: 'TEMPERMANENT failure',
      }),
    ).toBeNull()
    expect(
      classifyFrictionObservation({ type: 'tool-result', command: 'echo', escalationDetail: '  ' }),
    ).toBeNull()
    expect(
      classifyFrictionObservation({
        type: 'tool-result',
        command: 'echo ok',
        structuredStderr: 'ordinary diagnostic',
      }),
    ).toBeNull()
    expect(classifyFrictionObservation({ type: 'permission-request', command: '   ' })).toBeNull()
    expect(classifyFrictionObservation({ type: 'permission-request', command: '' })).toBeNull()
  })
})

describe('friction log', () => {
  it('touches a log for unclassified observations and reads absent/empty/events distinctly', async () => {
    const directoryPath = await directory()
    const options: FrictionLogOptions = { directory: directoryPath }
    expect(readFrictionLog('session', options)).toEqual({ status: 'absent' })
    recordFriction(
      'session',
      { type: 'tool-result', command: 'echo ok' },
      { ...options, timestamp: 't' },
    )
    expect(readFrictionLog('session', options)).toEqual({ status: 'empty' })
    recordFriction(
      'session',
      { type: 'tool-result', command: 'git push', escalationDetail: 'override' },
      { ...options, timestamp: '2026-01-01T00:00:00.000Z' },
    )
    expect(readFrictionLog('session', options)).toEqual({
      status: 'events',
      events: [
        {
          kind: 'sandbox-escalation',
          timestamp: '2026-01-01T00:00:00.000Z',
          commandPrefix: 'git push',
          detail: 'override',
        },
      ],
    })
  })

  it('requires an absolute directory and applies the event cap', async () => {
    expect(() => readFrictionLog('s', { directory: 'relative' })).toThrow(/absolute/)
    const directoryPath = await directory()
    for (let index = 0; index < FRICTION_LOG_MAX_EVENTS + 2; index++)
      recordFriction(
        'capped',
        { type: 'permission-request', command: 'git push' },
        { directory: directoryPath, maxEvents: 1_000, timestamp: String(index) },
      )
    const result = readFrictionLog('capped', { directory: directoryPath })
    expect(result.status).toBe('events')
    if (result.status === 'events') expect(result.events).toHaveLength(FRICTION_LOG_MAX_EVENTS)
    expect(isAbsolute(directoryPath)).toBe(true)
    const [file] = await readdir(directoryPath)
    const raw = await readFile(join(directoryPath, file!), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(FRICTION_LOG_MAX_EVENTS)
  })

  it('ignores malformed lines while retaining valid events', async () => {
    const directoryPath = await directory()
    recordFriction(
      'malformed',
      { type: 'permission-request', command: 'git push' },
      { directory: directoryPath, timestamp: 't' },
    )
    const [file] = await readdir(directoryPath)
    const path = join(directoryPath, file!)
    const original = await readFile(path, 'utf8')
    await rm(path)
    await writeFile(
      path,
      [
        'not-json',
        'null',
        '1',
        '{}',
        '{"kind":"other","timestamp":"t","commandPrefix":"git push","detail":"x"}',
        '{"kind":"sandbox-failure","timestamp":1,"commandPrefix":"git push","detail":"x"}',
        '{"kind":"sandbox-failure","timestamp":"t","commandPrefix":1,"detail":"x"}',
        '{"kind":"sandbox-failure","timestamp":"t","commandPrefix":"git push","detail":1}',
        original.trim(),
        '',
      ].join('\n'),
    )
    const result = readFrictionLog('malformed', { directory: directoryPath })
    expect(result.status).toBe('events')
    if (result.status === 'events') expect(result.events).toHaveLength(1)
  })

  it('separates a new event from an unterminated malformed line', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('unterminated', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    await writeFile(join(directoryPath, file!), 'not-json')
    recordFriction('unterminated', { type: 'permission-request', command: 'git push' }, options)
    expect(readFrictionLog('unterminated', options)).toMatchObject({
      status: 'events',
      events: [expect.objectContaining({ commandPrefix: 'git push' })],
    })
  })

  it('sanitizes session ids and validates limits before touching storage', async () => {
    const directoryPath = await directory()
    recordFriction(
      'parent:child/path',
      { type: 'permission-request', command: 'git push' },
      { directory: directoryPath, maxEvents: 1, timestamp: 't' },
    )
    expect(await readdir(directoryPath)).toEqual([expect.stringMatching(/^[a-f0-9]{64}\.jsonl$/)])
    expect(readFrictionLog('parent_child_path', { directory: directoryPath })).toEqual({
      status: 'absent',
    })
    expect(readFrictionLog('missing', { directory: join(directoryPath, 'missing') })).toEqual({
      status: 'absent',
    })
    expect(() =>
      recordFriction(
        'invalid-limit',
        { type: 'permission-request', command: 'git push' },
        { directory: directoryPath, maxEvents: 0 },
      ),
    ).toThrow(/positive integer/)
    await expect(readFile(join(directoryPath, 'invalid-limit.jsonl'), 'utf8')).rejects.toThrow()
  })

  it('isolates colliding ids and ignores malformed entries when capping', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath, maxEvents: 1, timestamp: 't' }
    recordFriction('parent:child', { type: 'permission-request', command: 'git push' }, options)
    recordFriction('parent/child', { type: 'permission-request', command: 'pnpm test' }, options)
    expect(readFrictionLog('parent:child', options)).toMatchObject({ status: 'events' })
    expect(readFrictionLog('parent/child', options)).toMatchObject({ status: 'events' })
    const beforeTouch = new Set(await readdir(directoryPath))
    recordFriction('malformed', { type: 'tool-result', command: 'echo ok' }, options)
    const file = (await readdir(directoryPath)).find((value) => !beforeTouch.has(value))
    await writeFile(join(directoryPath, file!), '{}\nnot-json\n')
    recordFriction('malformed', { type: 'permission-request', command: 'git push' }, options)
    expect(readFrictionLog('malformed', options)).toMatchObject({
      status: 'events',
      events: [expect.objectContaining({ commandPrefix: 'git push' })],
    })
    expect(() => readFrictionLog('', options)).toThrow(/non-empty/)
    expect(() => readFrictionLog('x'.repeat(4097), options)).toThrow(/too long/)
  })

  it('makes lock acquisition exhaustion explicit', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('locked', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    await writeFile(join(directoryPath, `${file}.lock`), '')
    expect(() =>
      recordFriction('locked', { type: 'permission-request', command: 'git push' }, options),
    ).toThrow(/could not acquire/)
  })

  it('recovers a lock whose owner process no longer exists', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('stale-lock', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    await writeFile(join(directoryPath, `${file}.lock`), '2147483647')
    recordFriction('stale-lock', { type: 'permission-request', command: 'git push' }, options)
    expect(readFrictionLog('stale-lock', options)).toMatchObject({ status: 'events' })
  })

  it('preserves a lock when its owner check is denied, then retries', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('owner-check', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    await writeFile(join(directoryPath, `${file}.lock`), '2147483647')
    const denied = Object.assign(new Error('denied'), { code: 'EPERM' })
    vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      throw denied
    })
    recordFriction('owner-check', { type: 'permission-request', command: 'git push' }, options)
    expect(readFrictionLog('owner-check', options)).toMatchObject({ status: 'events' })
  })

  it('recovers an ownerless lock after its lease expires', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('expired-lock', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    const lockPath = join(directoryPath, `${file}.lock`)
    await writeFile(lockPath, '')
    await utimes(lockPath, new Date(0), new Date(0))
    recordFriction('expired-lock', { type: 'permission-request', command: 'git push' }, options)
    expect(readFrictionLog('expired-lock', options)).toMatchObject({ status: 'events' })
  })

  it('preserves a future-dated lock while its owner is alive', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('reused-pid', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    const lockPath = join(directoryPath, `${file}.lock`)
    await writeFile(lockPath, String(process.pid))
    const future = new Date(Date.now() + 60_000)
    await utimes(lockPath, future, future)
    expect(() =>
      recordFriction('reused-pid', { type: 'permission-request', command: 'git push' }, options),
    ).toThrow(/could not acquire/)
  })

  it('rejects restrictive existing evidence directory permissions', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('denied-lock', { type: 'tool-result', command: 'echo ok' }, options)
    await chmod(directoryPath, 0o500)
    expect(() =>
      recordFriction('denied-lock', { type: 'permission-request', command: 'git push' }, options),
    ).toThrow(/private directory/)
    await chmod(directoryPath, 0o700)
  })

  it('bounds persisted escalation details', async () => {
    const directoryPath = await directory()
    recordFriction(
      'bounded-detail',
      { type: 'tool-result', command: 'git push', escalationDetail: 'x'.repeat(2_000) },
      { directory: directoryPath },
    )
    const result = readFrictionLog('bounded-detail', { directory: directoryPath })
    expect(result.status).toBe('events')
    if (result.status === 'events') expect(result.events[0]?.detail).toHaveLength(1_000)
  })

  it('bounds persisted timestamps and creates private evidence', async () => {
    const parent = await directory()
    const directoryPath = join(parent, 'private')
    recordFriction(
      'private-log',
      { type: 'permission-request', command: 'git push' },
      { directory: directoryPath, timestamp: 'x'.repeat(2_000) },
    )
    const [file] = await readdir(directoryPath)
    expect((await stat(directoryPath)).mode & 0o777).toBe(0o700)
    expect((await stat(join(directoryPath, file!))).mode & 0o777).toBe(0o600)
    const result = readFrictionLog('private-log', { directory: directoryPath })
    expect(result.status).toBe('events')
    if (result.status === 'events') expect(result.events[0]?.timestamp).toHaveLength(1_000)
  })

  it('bounds log reads even when malformed data bypasses the event cap', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('oversized-log', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    const path = join(directoryPath, file!)
    await writeFile(path, 'x'.repeat(2_000_000))
    expect(() =>
      recordFriction('oversized-log', { type: 'permission-request', command: 'git push' }, options),
    ).toThrow(/too large/)
    expect((await stat(path)).size).toBe(2_000_000)
    await writeFile(path, 'x'.repeat(2_000_001))
    expect(() => readFrictionLog('oversized-log', options)).toThrow(/too large/)
    expect(() =>
      recordFriction('oversized-log', { type: 'permission-request', command: 'git push' }, options),
    ).toThrow(/too large/)
  })

  it('uses the session lock while first log creation is in progress', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('read-locked', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    await rm(join(directoryPath, file!))
    await writeFile(join(directoryPath, `${file}.lock`), '')
    expect(() => readFrictionLog('read-locked', options)).toThrow(/could not acquire/)
  })

  it('returns absent when a log disappears while waiting for its lock', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('removed-log', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    const path = join(directoryPath, file!)
    await writeFile(`${path}.lock`, '2147483647')
    vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      rmSync(directoryPath, { recursive: true })
      throw Object.assign(new Error('gone'), { code: 'ESRCH' })
    })
    expect(readFrictionLog('removed-log', options)).toEqual({ status: 'absent' })
  })

  it('waits while stale-lock reclamation is in progress', async () => {
    const directoryPath = await directory()
    const options = { directory: directoryPath }
    recordFriction('reaping', { type: 'tool-result', command: 'echo ok' }, options)
    const [file] = await readdir(directoryPath)
    await writeFile(join(directoryPath, `${file}.lock.reap`), '')
    expect(() => readFrictionLog('reaping', options)).toThrow(/could not acquire/)
  })

  it('supports callback and generated timestamps', async () => {
    const directoryPath = await directory()
    recordFriction(
      'timestamps',
      { type: 'permission-request', command: 'git push' },
      { directory: directoryPath, timestamp: () => 'callback' },
    )
    recordFriction(
      'timestamps',
      { type: 'permission-request', command: 'pnpm test' },
      { directory: directoryPath },
    )
    recordFriction(
      'timestamps',
      { type: 'permission-request', command: 'npm test' },
      { directory: directoryPath, timestamp: '\n' },
    )
    const result = readFrictionLog('timestamps', { directory: directoryPath })
    expect(result.status).toBe('events')
    if (result.status === 'events') {
      expect(result.events[0]?.timestamp).toBe('callback')
      expect(result.events[1]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(result.events[2]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })
})
