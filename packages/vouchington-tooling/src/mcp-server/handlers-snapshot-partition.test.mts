import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BLACKBOARD_ENV } from './fake-blackboard.test-helpers.mts'
import { harness, jsonOf, textOf, useRepoFixture } from './harness.test-helpers.mts'
import { createSnapshotRegistry } from './snapshot-registry.mts'

const fixture = useRepoFixture()
const OWNER = 'native:owner'
const PATH = '/private/server-tmp/agent-blackboard-snapshot-x.jsonl'
const CHECKSUM = { algorithm: 'sha256', value: 'a'.repeat(64) }
const COUNTS = { sessions: 2, entries: 2, records: 5, bytes: 100 }
const PARTITIONED = {
  directory: '/private/server-tmp/agent-blackboard-partitions-abc',
  partitions: [],
}
const created: string[] = []

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function setup(
  exportResult: unknown,
  options: {
    partition?: (options: unknown) => Promise<unknown>
    cleanup?: (options: unknown) => Promise<void>
    env?: NodeJS.ProcessEnv
  } = {},
) {
  const h = harness(fixture(), {
    snapshots: createSnapshotRegistry(),
    exportResult,
    ...(options.partition === undefined ? {} : { clientPartition: options.partition }),
    ...(options.cleanup === undefined ? {} : { clientCleanup: options.cleanup }),
    ...(options.env === undefined ? {} : { env: options.env }),
  })
  const result = jsonOf(await h.call('snapshot_export', { sessionId: OWNER }))
  const call = (args: Record<string, unknown> = {}, sessionId = OWNER) =>
    h.call('snapshot_partition', { sessionId, cleanupToken: result.cleanupToken, ...args })
  return { h, call, cleanupToken: result.cleanupToken as string }
}

const clientExport = {
  path: PATH,
  checksum: CHECKSUM,
  counts: COUNTS,
  cleanupToken: 'client-secret',
}

describe('snapshot_partition with a capability-aware client', () => {
  it('partitions with the real client token and the recorded path, never returning the token', async () => {
    const partition = vi.fn(async () => PARTITIONED)
    const { call, cleanupToken } = await setup(clientExport, { partition })
    const result = await call()
    expect(result.isError).toBeUndefined()
    expect(jsonOf(result)).toEqual({ sessionId: OWNER, ...PARTITIONED })
    expect(textOf(result)).not.toContain('client-secret')
    expect(partition).toHaveBeenCalledExactlyOnceWith({
      path: PATH,
      checksum: CHECKSUM,
      counts: COUNTS,
      cleanupToken: 'client-secret',
    })
    expect(cleanupToken).not.toBe('client-secret')
  })

  it('lets the caller override the verification and the bounds', async () => {
    const partition = vi.fn(async () => PARTITIONED)
    const { call } = await setup(clientExport, { partition })
    const checksum = 'b'.repeat(64)
    const counts = { sessions: 1, entries: 1, records: 3, bytes: 9 }
    await call({ checksum, counts, maxSessions: 5, maxBytes: 4096 })
    expect(partition).toHaveBeenCalledExactlyOnceWith({
      path: PATH,
      checksum: { algorithm: 'sha256', value: checksum },
      counts,
      maxSessions: 5,
      maxBytes: 4096,
      cleanupToken: 'client-secret',
    })
  })

  it('verifies nothing the export did not report', async () => {
    const partition = vi.fn(async () => PARTITIONED)
    const { call } = await setup({ path: PATH, cleanupToken: 'client-secret' }, { partition })
    await call()
    expect(partition).toHaveBeenCalledExactlyOnceWith({ path: PATH, cleanupToken: 'client-secret' })
  })

  it('does not depend on the caller TMPDIR: the path is the server record, not the caller input', async () => {
    const partition = vi.fn(async () => PARTITIONED)
    const env = { ...BLACKBOARD_ENV, TMPDIR: '/sandbox/caller/tmp' }
    const { call } = await setup(clientExport, { partition, env })
    await call()
    expect(partition).toHaveBeenCalledWith(expect.objectContaining({ path: PATH }))
    const unsupported = await call({
      path: '/sandbox/caller/tmp/agent-blackboard-snapshot-y.jsonl',
    })
    expect(textOf(unsupported)).toContain('unsupported argument(s): path')
  })

  it('records the partition so cleanup removes the snapshot and the partitions with the client token', async () => {
    const cleanup = vi.fn(async () => undefined)
    const { h, call, cleanupToken } = await setup(clientExport, {
      partition: async () => PARTITIONED,
      cleanup,
    })
    await call()
    const cleaned = await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(jsonOf(cleaned)).toEqual({ sessionId: OWNER, cleaned: true })
    expect(cleanup).toHaveBeenCalledExactlyOnceWith({
      path: PATH,
      directory: PARTITIONED.directory,
      cleanupToken: 'client-secret',
    })
  })

  it('keeps the token valid after a failed partition so the same call can retry', async () => {
    const partition = vi
      .fn()
      .mockRejectedValueOnce(new Error('snapshot checksum does not match'))
      .mockRejectedValueOnce('plain failure')
      .mockResolvedValue(PARTITIONED)
    const { call } = await setup(clientExport, { partition })
    const failed = await call()
    expect(failed.isError).toBe(true)
    expect(textOf(failed)).toContain('still valid')
    expect(textOf(failed)).toContain('snapshot checksum does not match')
    expect(textOf(await call())).toContain('plain failure')
    expect((await call()).isError).toBeUndefined()
  })

  it('rejects a snapshot that is already partitioned and keeps the recorded partitions', async () => {
    const partition = vi.fn(async () => PARTITIONED)
    const cleanup = vi.fn(async () => undefined)
    const { h, call, cleanupToken } = await setup(clientExport, { partition, cleanup })
    await call()
    const again = await call()
    expect(textOf(again)).toContain('already partitioned')
    expect(partition).toHaveBeenCalledTimes(1)
    await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(cleanup).toHaveBeenCalledWith(
      expect.objectContaining({ directory: PARTITIONED.directory }),
    )
  })

  it('rejects an unexpected client result and still records any directory it created', async () => {
    for (const bad of [null, { directory: 1, partitions: [] }]) {
      const cleanup = vi.fn(async () => undefined)
      const { h, call, cleanupToken } = await setup(clientExport, {
        partition: async () => bad,
        cleanup,
      })
      expect(textOf(await call())).toContain('unexpected snapshot partition result')
      await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
      expect(cleanup).toHaveBeenCalledExactlyOnceWith({ path: PATH, cleanupToken: 'client-secret' })
    }
    const cleanup = vi.fn(async () => undefined)
    const { h, call, cleanupToken } = await setup(clientExport, {
      partition: async () => ({ directory: '/d' }),
      cleanup,
    })
    expect(textOf(await call())).toContain('unexpected snapshot partition result')
    await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(cleanup).toHaveBeenCalledExactlyOnceWith({
      path: PATH,
      directory: '/d',
      cleanupToken: 'client-secret',
    })
  })

  it('names the upgrade when the client holds a capability but cannot partition', async () => {
    const { call } = await setup(clientExport)
    expect(textOf(await call())).toContain('cannot partition snapshots')
  })
})

describe('snapshot_partition token rules', () => {
  it('rejects an unknown, forged, other-session, other-worktree, or spent token', async () => {
    const partition = vi.fn(async () => PARTITIONED)
    const { h, call, cleanupToken } = await setup(clientExport, {
      partition,
      cleanup: async () => {},
    })
    for (const forged of ['forged', 'client-secret', PATH]) {
      const result = await call({ cleanupToken: forged })
      expect(textOf(result)).toContain('unknown, already used')
    }
    expect(textOf(await call({}, 'native:other'))).toContain('another session or worktree')
    const elsewhere = await h.call('snapshot_partition', {
      sessionId: OWNER,
      worktree: fixture().linked,
      cleanupToken,
    })
    expect(textOf(elsewhere)).toContain('another session or worktree')
    expect(partition).not.toHaveBeenCalled()
    await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(textOf(await call())).toContain('unknown, already used')
    expect(partition).not.toHaveBeenCalled()
  })

  it('requires the token and validates the options before touching the record', async () => {
    const partition = vi.fn(async () => PARTITIONED)
    const { h, call } = await setup(clientExport, { partition })
    expect(textOf(await h.call('snapshot_partition', { sessionId: OWNER }))).toContain(
      'cleanupToken is required',
    )
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ checksum: 'abc' }, 'checksum must be a sha256 hex digest'],
      [{ counts: { sessions: 1 } }, 'counts must hold exactly'],
      [{ counts: { ...COUNTS, bytes: -1 } }, 'counts must hold exactly'],
      [{ counts: { ...COUNTS, extra: 1 } }, 'counts must hold exactly'],
      [{ counts: [] }, 'counts must be an object'],
      [{ maxSessions: 0 }, 'maxSessions must be a positive integer'],
      [{ maxBytes: '9' }, 'maxBytes must be a positive integer'],
    ]
    for (const [args, message] of bad) expect(textOf(await call(args))).toContain(message)
    // Validation errors did not spend the token.
    expect((await call()).isError).toBeUndefined()
  })
})

function snapshotRecords() {
  const sessions = ['one', 'two'].map((id, index) => ({
    id,
    parentSessionId: null,
    agent: 'agent',
    version: '1',
    createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }))
  return [
    ...sessions.flatMap((session) => [
      { type: 'session', session },
      {
        type: 'entry',
        entry: { sessionId: session.id, createdAt: session.createdAt, data: { id: session.id } },
      },
    ]),
    {
      type: 'manifest',
      manifest: {
        schemaVersion: 1,
        status: 'complete',
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
        selection: { archived: false },
        counts: { sessions: 2, entries: 2, records: 5 },
        ordering: {
          sessions: 'createdAt ascending',
          entries: 'createdAt ascending within session',
        },
        consistency: 'best-effort',
      },
    },
  ]
}

describe('snapshot_partition without a client capability', () => {
  it('partitions a real file in the server temp directory and cleanup removes both', async () => {
    const path = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    writeFileSync(
      path,
      `${snapshotRecords()
        .map((r) => JSON.stringify(r))
        .join('\n')}\n`,
    )
    created.push(path)
    const { h, call, cleanupToken } = await setup(
      { path },
      { env: { ...BLACKBOARD_ENV, TMPDIR: '/not/the/server/tmp' } },
    )
    const result = jsonOf(await call({ maxSessions: 1 }))
    const directory = result.directory as string
    created.push(directory)
    expect(directory.startsWith(tmpdir())).toBe(true)
    expect(result.partitions).toHaveLength(2)
    expect(JSON.stringify(result.partitions)).toContain('"algorithm":"sha256"')
    expect(readdirSync(directory).length).toBeGreaterThan(0)

    expect(
      jsonOf(await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })).cleaned,
    ).toBe(true)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(directory)).toBe(false)
    // Idempotent and safe: the spent token deletes nothing.
    expect(textOf(await call())).toContain('unknown, already used')
  })

  it('refuses a path outside the temp directory and keeps the token valid', async () => {
    const { call } = await setup({ path: '/elsewhere/agent-blackboard-snapshot-x.jsonl' })
    const result = await call()
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('generated temporary snapshot path')
    expect(textOf(await call())).toContain('still valid')
  })
})
