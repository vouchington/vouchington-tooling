import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RECEIPT_NAME } from '../agent-blackboard/snapshot-cleanup-receipt.mts'
import { partitionSnapshot } from '../agent-blackboard/snapshot-partitions.mts'
import { harness, textOf, useRepoFixture } from './harness.test-helpers.mts'
import { createSnapshotRegistry } from './snapshot-registry.mts'

const fixture = useRepoFixture()
const OWNER = 'native:owner'
const created: string[] = []
const CREATED_AT = '2026-01-01T00:00:00.000Z'

function records(): string {
  const session = {
    id: 'session:one',
    parentSessionId: null,
    agent: 'codex',
    version: '1',
    createdAt: CREATED_AT,
    lastEntryAt: null,
    archivedAt: null,
    data: {},
  }
  const manifest = {
    schemaVersion: 1,
    status: 'complete',
    createdAt: CREATED_AT,
    completedAt: CREATED_AT,
    selection: { archived: false },
    counts: { sessions: 1, entries: 0, records: 2 },
    ordering: { sessions: 'createdAt ascending', entries: 'createdAt ascending within session' },
    consistency: 'best-effort',
  }
  return `${JSON.stringify({ type: 'session', session })}\n${JSON.stringify({ type: 'manifest', manifest })}\n`
}

/** A generated snapshot partitioned in-process, as the server did before the "restart". */
async function partitioned(owner: { sessionId: string; worktree: string } | undefined) {
  const source = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  writeFileSync(source, records(), { mode: 0o400 })
  created.push(source)
  const result = await partitionSnapshot({
    path: source,
    ...(owner === undefined ? {} : { owner: { ...owner, source } }),
  })
  created.push(result.directory)
  return { source, directory: result.directory }
}

function recover(args: Record<string, unknown>, worktree?: string) {
  // A fresh registry: nothing from before the restart is remembered.
  const h = harness(fixture(), { snapshots: createSnapshotRegistry() })
  return h.call('snapshot_cleanup', { sessionId: OWNER, worktree, ...args })
}

function rewriteMarker(directory: string, edit: (receipt: Record<string, any>) => unknown): void {
  const marker = join(directory, RECEIPT_NAME)
  const receipt = JSON.parse(readFileSync(marker, 'utf8')) as Record<string, any>
  chmodSync(marker, 0o600)
  writeFileSync(marker, JSON.stringify(edit(receipt)))
  chmodSync(marker, 0o400)
}

afterEach(() => {
  for (const path of created.splice(0)) {
    try {
      chmodSync(path, 0o700)
    } catch {}
    rmSync(path, { recursive: true, force: true })
  }
})

describe('snapshot_cleanup recoveryDirectory after a restart', () => {
  it('cleans a generated snapshot exactly once', async () => {
    const { source, directory } = await partitioned({
      sessionId: OWNER,
      worktree: fixture().main,
    })
    const result = await recover({ recoveryDirectory: directory })
    expect(result.isError).toBeUndefined()
    expect(existsSync(directory)).toBe(false)
    expect(existsSync(source)).toBe(false)

    // Single use: the same output cannot be recovered again, and a bystander is left alone.
    const bystander = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    writeFileSync(bystander, 'keep')
    created.push(bystander)
    const again = await recover({ recoveryDirectory: directory })
    expect(again.isError).toBe(true)
    expect(textOf(again)).toContain('nothing was deleted')
    expect(existsSync(bystander)).toBe(true)
  })

  it('refuses two concurrent recoveries of the same directory', async () => {
    const { directory } = await partitioned({ sessionId: OWNER, worktree: fixture().main })
    const results = await Promise.all([
      recover({ recoveryDirectory: directory }),
      recover({ recoveryDirectory: directory }),
    ])
    expect(results.filter((result) => result.isError).length).toBe(1)
    expect(existsSync(directory)).toBe(false)
  })

  it('rejects another session or another worktree and deletes nothing', async () => {
    const { source, directory } = await partitioned({
      sessionId: OWNER,
      worktree: fixture().main,
    })
    const session = await recover({ recoveryDirectory: directory, sessionId: 'native:other' })
    const worktree = await recover({ recoveryDirectory: directory }, fixture().linked)
    for (const result of [session, worktree]) {
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('nothing was deleted')
    }
    expect(textOf(session)).toBe(textOf(worktree))
    expect(existsSync(directory)).toBe(true)
    expect(existsSync(source)).toBe(true)
  })

  it('rejects a receipt signed without an owner', async () => {
    const { source, directory } = await partitioned(undefined)
    const result = await recover({ recoveryDirectory: directory })
    expect(result.isError).toBe(true)
    expect(existsSync(directory)).toBe(true)
    expect(existsSync(source)).toBe(true)
  })

  it('rejects a tampered receipt: the owner cannot be rewritten without the key', async () => {
    const { directory } = await partitioned({ sessionId: 'native:other', worktree: fixture().main })
    rewriteMarker(directory, (receipt) => ({
      ...receipt,
      owner: { ...receipt.owner, sessionId: OWNER },
    }))
    expect((await recover({ recoveryDirectory: directory })).isError).toBe(true)
    expect(existsSync(directory)).toBe(true)
  })

  it('rejects a tampered source path, an unsigned receipt, and malformed owners', async () => {
    const { directory } = await partitioned({ sessionId: OWNER, worktree: fixture().main })
    const victim = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
    writeFileSync(victim, 'keep')
    created.push(victim)
    const edits: Array<(receipt: Record<string, any>) => unknown> = [
      (r) => ({ ...r, owner: { ...r.owner, source: victim } }),
      ({ signature: _signature, ...r }) => r,
      (r) => ({ ...r, owner: 'native:owner' }),
      (r) => ({ ...r, owner: { ...r.owner, sessionId: '' } }),
      (r) => ({ ...r, owner: { ...r.owner, extra: 'x' } }),
      () => 'not a receipt',
    ]
    const original = readFileSync(join(directory, RECEIPT_NAME), 'utf8')
    for (const edit of edits) {
      rewriteMarker(directory, (receipt) => edit(receipt))
      expect((await recover({ recoveryDirectory: directory })).isError).toBe(true)
      rewriteMarker(directory, () => JSON.parse(original))
    }
    expect(existsSync(victim)).toBe(true)
    expect(existsSync(directory)).toBe(true)
  })

  it('rejects a valid receipt copied into another directory', async () => {
    const first = await partitioned({ sessionId: OWNER, worktree: fixture().main })
    const second = await partitioned({ sessionId: OWNER, worktree: fixture().main })
    rewriteMarker(second.directory, () =>
      JSON.parse(readFileSync(join(first.directory, RECEIPT_NAME), 'utf8')),
    )
    expect((await recover({ recoveryDirectory: second.directory })).isError).toBe(true)
    expect(existsSync(first.directory)).toBe(true)
    expect(existsSync(second.directory)).toBe(true)
  })

  it('rejects paths outside the expected temp location or without the generated name', async () => {
    const { directory } = await partitioned({ sessionId: OWNER, worktree: fixture().main })
    const nested = mkdtempSync(join(tmpdir(), 'nested-'))
    created.push(nested)
    const copy = join(nested, 'agent-blackboard-partitions-copy')
    mkdirSync(copy)
    const other = join(tmpdir(), `agent-blackboard-other-${randomUUID()}`)
    mkdirSync(other)
    created.push(other)
    for (const path of [
      copy,
      `${nested}/../${directory.split('/').at(-1)!}`,
      other,
      'agent-blackboard-partitions-relative',
      join(tmpdir(), `agent-blackboard-partitions-missing${randomUUID().replaceAll('-', '')}`),
    ]) {
      const result = await recover({ recoveryDirectory: path })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('nothing was deleted')
    }
    expect(existsSync(directory)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })

  it('rejects a symlinked directory and a symlinked or oversized marker', async () => {
    const { directory } = await partitioned({ sessionId: OWNER, worktree: fixture().main })
    const link = join(
      tmpdir(),
      `agent-blackboard-partitions-link${randomUUID().replaceAll('-', '')}`,
    )
    symlinkSync(directory, link)
    created.push(link)
    expect((await recover({ recoveryDirectory: link })).isError).toBe(true)
    expect(existsSync(directory)).toBe(true)

    const marker = join(directory, RECEIPT_NAME)
    const original = readFileSync(marker, 'utf8')
    chmodSync(marker, 0o600)
    unlinkSync(marker)
    const elsewhere = join(tmpdir(), `marker-${randomUUID()}.json`)
    writeFileSync(elsewhere, original)
    created.push(elsewhere)
    symlinkSync(elsewhere, marker)
    expect((await recover({ recoveryDirectory: directory })).isError).toBe(true)
    unlinkSync(marker)
    writeFileSync(marker, ' '.repeat(70 * 1024))
    expect((await recover({ recoveryDirectory: directory })).isError).toBe(true)
    expect(existsSync(directory)).toBe(true)
  })

  it('requires exactly one of cleanupToken and recoveryDirectory', async () => {
    const neither = await recover({})
    const both = await recover({ cleanupToken: 'x', recoveryDirectory: '/x' })
    expect(textOf(neither)).toContain('cleanupToken is required')
    expect(textOf(both)).toContain('exactly one of')
  })
})
