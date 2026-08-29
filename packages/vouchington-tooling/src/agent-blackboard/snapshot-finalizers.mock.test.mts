import { randomUUID } from 'node:crypto'
import { mkdtemp, open as actualOpen, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const closeFailure = vi.hoisted(() => ({ mode: '' as '' | 'stage' | 'partition' | 'source' }))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args)
      const path = String(args[0])
      if (
        (closeFailure.mode === 'stage' && path.includes('snapshot-stage-')) ||
        (closeFailure.mode === 'partition' && path.includes('.partition-')) ||
        (closeFailure.mode === 'source' && path.includes('agent-blackboard-snapshot-'))
      )
        file.close = async () => {
          throw new Error('injected close failure')
        }
      return file
    },
  }
})

import { stageSnapshot } from './snapshot-partition-read.mts'
import { writePartitions } from './snapshot-partition-write.mts'
import { partitionSnapshot } from './snapshot.mts'
import { setSnapshotFilesystemForTest } from './snapshot-partitions.mts'

const paths = new Set<string>()
const createdAt = '2026-01-01T00:00:00.000Z'
const session = {
  id: 'session:one',
  parentSessionId: null,
  agent: 'codex',
  version: '1',
  createdAt,
  lastEntryAt: null,
  archivedAt: null,
  data: {},
}
const manifest = {
  schemaVersion: 1 as const,
  status: 'complete' as const,
  createdAt,
  completedAt: createdAt,
  selection: { archived: false as const },
  counts: { sessions: 1, entries: 0, records: 2 },
  ordering: {
    sessions: 'createdAt ascending' as const,
    entries: 'createdAt ascending within session' as const,
  },
  consistency: 'best-effort' as const,
}

afterEach(async () => {
  closeFailure.mode = ''
  setSnapshotFilesystemForTest()
  await Promise.all([...paths].map((path) => rm(path, { recursive: true, force: true })))
  paths.clear()
})

async function source(): Promise<string> {
  const path = join(tmpdir(), `agent-blackboard-snapshot-${randomUUID()}.jsonl`)
  await writeFile(path, `${JSON.stringify({ type: 'session', session })}\n{`, { mode: 0o400 })
  paths.add(path)
  return path
}

describe('snapshot close failure finalizers', () => {
  it('preserves a staging parse failure when both staged files refuse to close', async () => {
    const path = await source()
    const stage = await mkdtemp(join(tmpdir(), 'snapshot-stage-'))
    paths.add(stage)
    const input = await actualOpen(path, 'r')
    closeFailure.mode = 'stage'
    try {
      await expect(stageSnapshot(input, stage)).rejects.toThrow('invalid JSONL')
    } finally {
      closeFailure.mode = ''
      await input.close()
    }
  })

  it('swallows an active partition close failure while propagating copy failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'partition-finalizer-'))
    paths.add(root)
    const index = join(root, 'index.jsonl')
    await writeFile(
      index,
      `${JSON.stringify({ sessionId: 'missing', path: join(root, 'missing'), bytes: 1, sessions: 1, entries: 0 })}\n`,
    )
    closeFailure.mode = 'partition'
    await expect(writePartitions(index, manifest, root, 1, 1000)).rejects.toThrow('ENOENT')
  })

  it('swallows a source close failure after setup fails', async () => {
    const path = await source()
    closeFailure.mode = 'source'
    setSnapshotFilesystemForTest({
      mkdtemp: async () => {
        throw new Error('setup failed')
      },
    })
    await expect(partitionSnapshot({ path })).rejects.toThrow('setup failed')
  })
})
