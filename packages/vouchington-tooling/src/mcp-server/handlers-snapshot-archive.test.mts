import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { harness, jsonOf, textOf, useRepoFixture } from './harness.test-helpers.mts'
import { createSnapshotRegistry } from './snapshot-registry.mts'

const fixture = useRepoFixture()
const OWNER = 'native:owner'
const AT = '2026-01-01T00:00:00.000Z'
const created: string[] = []

type Entry = { sessionId: string; createdAt: string; data: Record<string, unknown> }

const entry = (sessionId: string, id: string, timestamp = AT): Entry => ({
  sessionId,
  createdAt: AT,
  data: { type: 'journal', sourceEventId: id, markdown: `secret ${id}`, timestamp },
})
const session = (id: string) => ({
  id,
  parentSessionId: null,
  agent: 'codex',
  version: '1',
  createdAt: AT,
  lastEntryAt: null,
  archivedAt: null,
  data: {},
})

function writeSnapshot(sessions: Array<[string, Entry[]]>, extra: string[] = []): string {
  const lines = sessions.flatMap(([id, entries]) => [
    JSON.stringify({ type: 'session', session: session(id) }),
    ...entries.map((item) => JSON.stringify({ type: 'entry', entry: item })),
  ])
  const counts = {
    sessions: sessions.length,
    entries: sessions.reduce((sum, [, list]) => sum + list.length, 0),
    records: lines.length + 1,
  }
  const manifest = {
    schemaVersion: 1,
    status: 'complete',
    createdAt: AT,
    completedAt: AT,
    selection: { archived: false },
    counts,
    ordering: { sessions: 'createdAt ascending', entries: 'createdAt ascending within session' },
    consistency: 'best-effort',
  }
  const path = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  writeFileSync(
    path,
    [...lines, JSON.stringify({ type: 'manifest', manifest }), ...extra].join('\n') + '\n',
  )
  created.push(path)
  return path
}

async function setup(
  sessions: Array<[string, Entry[]]>,
  live: Entry[],
  options: Parameters<typeof harness>[1] = {},
  checksum = true,
) {
  const path = writeSnapshot(sessions)
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
  const h = harness(fixture(), {
    snapshots: createSnapshotRegistry(),
    entries: live,
    exportResult: {
      path,
      ...(checksum ? { checksum: { algorithm: 'sha256', value: digest } } : {}),
    },
    ...options,
  })
  const { cleanupToken } = jsonOf(await h.call('snapshot_export', { sessionId: OWNER }))
  const call = (args: Record<string, unknown> = {}) =>
    h.call('snapshot_archive', { sessionId: OWNER, cleanupToken, ...args })
  return { h, call, cleanupToken, path }
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('snapshot_archive', () => {
  it('archives exact matches, ignoring timestamps, and returns no entry content', async () => {
    const a = [entry('s:a', 'e1'), entry('s:a', 'e2')]
    const { h, call } = await setup(
      [
        ['s:a', a],
        ['s:empty', []],
        ['s:unlisted', [entry('s:unlisted', 'e1')]],
      ],
      [
        entry('s:a', 'e1', '2026-02-02T00:00:00.000Z'),
        entry('s:a', 'e2'),
        entry('s:a', 'e2', '2027-01-01T00:00:00.000Z'),
      ],
    )
    const result = await call({ sessionIds: ['s:a', 's:empty', 's:a'] })
    expect(jsonOf(result)).toEqual({ sessionId: OWNER, archived: ['s:a', 's:empty'], skipped: [] })
    expect(textOf(result)).not.toContain('secret')
    expect(h.fake.calls.archive).toEqual(['s:a', 's:empty'])
  })

  it('skips sessions with a reason and never archives them', async () => {
    const { h, call } = await setup(
      [
        ['s:added', [entry('s:added', 'e1')]],
        ['s:gone', [entry('s:gone', 'e1')]],
        ['s:edited', [entry('s:edited', 'e1')]],
        ['s:fewer', [entry('s:fewer', 'e1'), entry('s:fewer', 'e2')]],
      ],
      [
        entry('s:added', 'e1'),
        entry('s:added', 'late'),
        {
          ...entry('s:edited', 'e1'),
          data: { ...entry('s:edited', 'e1').data, markdown: 'changed' },
        },
        entry('s:fewer', 'e1'),
      ],
      { entriesErrors: { 's:gone': { status: 404 } } },
    )
    const result = jsonOf(
      await call({ sessionIds: ['s:added', 's:gone', 's:edited', 's:fewer', 's:other'] }),
    )
    expect(result.archived).toEqual([])
    expect(result.skipped).toEqual([
      { sessionId: 's:added', reason: 'entries changed since the export' },
      { sessionId: 's:gone', reason: 'session not found' },
      { sessionId: 's:edited', reason: 'entries changed since the export' },
      { sessionId: 's:fewer', reason: 'entries changed since the export' },
      { sessionId: 's:other', reason: 'not in the export' },
    ])
    expect(h.fake.calls.archive).toEqual([])
  })

  it('reports per-session read and archive failures and keeps going', async () => {
    const { h, call } = await setup(
      [
        ['s:read', []],
        ['s:arch', []],
        ['s:ok', []],
      ],
      [],
      {
        entriesErrors: { 's:read': new Error('boom') },
        archiveErrors: { 's:arch': 'x'.repeat(500) },
      },
    )
    const result = jsonOf(await call({ sessionIds: ['s:read', 's:arch', 's:ok'] }))
    expect(result.archived).toEqual(['s:ok'])
    const skipped = result.skipped as Array<{ reason: string }>
    expect(skipped[0]).toEqual({ sessionId: 's:read', reason: 'failed: boom' })
    expect(skipped[1]?.reason).toHaveLength(200)
    expect(h.fake.calls.archive).toEqual(['s:ok'])
  })

  it('leaves the token valid for snapshot_cleanup and for another archive call', async () => {
    const { h, call, cleanupToken, path } = await setup([['s:a', []]], [])
    await call({ sessionIds: ['s:a'] })
    expect(jsonOf(await call({ sessionIds: ['s:a'] })).archived).toEqual(['s:a'])
    const cleaned = await h.call('snapshot_cleanup', { sessionId: OWNER, cleanupToken })
    expect(jsonOf(cleaned).cleaned).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  it('works when the export reported no checksum', async () => {
    const { call } = await setup([['s:a', []]], [], {}, false)
    expect(jsonOf(await call({ sessionIds: ['s:a'] })).archived).toEqual(['s:a'])
  })

  it('refuses a file that no longer matches the export checksum, archiving nothing', async () => {
    const { h, call, path } = await setup([['s:a', []]], [])
    writeFileSync(path, readFileSync(path, 'utf8').replace('codex', 'codeX'))
    const result = await call({ sessionIds: ['s:a'] })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('cleanupToken is still valid')
    expect(textOf(result)).toContain('checksum does not match')
    expect(h.fake.calls.archive).toEqual([])
    // The token survived the failure, so the same call still reaches the file check.
    expect(textOf(await call({ sessionIds: ['s:a'] }))).toContain('checksum does not match')
  })

  it('refuses a symlink or a directory in place of the snapshot', async () => {
    const link = await setup([['s:a', []]], [])
    rmSync(link.path)
    symlinkSync(tmpdir(), link.path)
    expect(textOf(await link.call({ sessionIds: ['s:a'] }))).toContain('ELOOP')
    const dir = await setup([['s:a', []]], [])
    rmSync(dir.path)
    mkdirSync(dir.path)
    expect(textOf(await dir.call({ sessionIds: ['s:a'] }))).toContain('not a regular file')
  })

  it('rejects a malformed snapshot rather than trusting a partial read', async () => {
    const { call, path } = await setup([['s:a', []]], [], {}, false)
    writeFileSync(path, 'not json\n')
    expect(textOf(await call({ sessionIds: ['s:a'] }))).toContain('invalid JSONL')
  })

  it('validates its arguments before touching anything', async () => {
    const { h, call, cleanupToken } = await setup([['s:a', []]], [])
    const over = Array.from({ length: 101 }, (_, index) => `s:${index}`)
    expect(textOf(await call({ sessionIds: over }))).toContain('at most 100')
    expect(textOf(await call({ sessionIds: [] }))).toContain('non-empty array')
    expect(textOf(await call({ sessionIds: ['../x'] }))).toContain('session id must be URL-safe')
    expect(textOf(await call({ sessionIds: ['s:a'], path: '/x' }))).toContain(
      'unsupported argument',
    )
    expect(
      textOf(await h.call('snapshot_archive', { sessionId: OWNER, sessionIds: ['s:a'] })),
    ).toContain('cleanupToken is required')
    expect(h.fake.calls.archive).toEqual([])
    expect(jsonOf(await call({ sessionIds: ['s:a'] })).archived).toEqual(['s:a'])
    expect(cleanupToken).toBeTruthy()
  })

  it('rejects forged tokens and tokens bound to another session or worktree', async () => {
    const { h, cleanupToken } = await setup([['s:a', []]], [])
    for (const [sessionId, token] of [
      [OWNER, 'forged'],
      ['native:other', cleanupToken],
    ] as const) {
      const result = await h.call('snapshot_archive', {
        sessionId,
        cleanupToken: token,
        sessionIds: ['s:a'],
      })
      expect(textOf(result)).toContain('unknown, already used, or bound to another')
    }
    expect(h.fake.calls.archive).toEqual([])
  })

  it('surfaces a stringly entry error and a missing archive capability per session', async () => {
    const { call } = await setup([['s:a', []]], [], { omitArchive: true })
    const result = jsonOf(await call({ sessionIds: ['s:a'] }))
    expect(result.archived).toEqual([])
    expect(JSON.stringify(result.skipped)).toContain('cannot archive sessions')
  })
})

describe('snapshot_archive with legacy live entries', () => {
  it('compares an entry whose data is not an object by its own value', async () => {
    const legacy = { sessionId: 's:a', createdAt: AT, data: 'legacy' as never }
    const { call } = await setup([['s:a', []]], [legacy])
    expect(jsonOf(await call({ sessionIds: ['s:a'] })).skipped).toEqual([
      { sessionId: 's:a', reason: 'entries changed since the export' },
    ])
  })
})
