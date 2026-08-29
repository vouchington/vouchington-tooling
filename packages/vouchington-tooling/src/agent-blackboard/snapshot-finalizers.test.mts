import { randomUUID } from 'node:crypto'
import { mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadCleanupSigningKey,
  setCleanupKeyTempDirectoryForTest,
} from './snapshot-cleanup-key.mts'
import { stageSnapshot } from './snapshot-partition-read.mts'
import { validatePartition } from './snapshot-partition-validate.mts'
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
  setCleanupKeyTempDirectoryForTest()
  setSnapshotFilesystemForTest()
  await Promise.all([...paths].map((path) => rm(path, { recursive: true, force: true })))
  paths.clear()
})

async function temporary(name: string, contents: string): Promise<string> {
  const path = join(tmpdir(), `${name}-${randomUUID()}.jsonl`)
  await writeFile(path, contents, { mode: 0o400 })
  paths.add(path)
  return path
}
async function snapshot(two = false): Promise<string> {
  const records = [
    { type: 'session', session },
    ...(two
      ? [
          {
            type: 'session',
            session: { ...session, id: 'session:two', createdAt: '2026-01-02T00:00:00.000Z' },
          },
        ]
      : []),
    {
      type: 'manifest',
      manifest: {
        ...manifest,
        counts: { sessions: two ? 2 : 1, entries: 0, records: two ? 3 : 2 },
      },
    },
  ]
  return temporary(
    'agent-blackboard-snapshot',
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  )
}

describe('snapshot finalizers and identity guards', () => {
  it('rejects absent POSIX identities and a key whose opened descriptor changed', async () => {
    const original = process.geteuid
    Object.defineProperty(process, 'geteuid', { configurable: true, value: undefined })
    await expect(loadCleanupSigningKey()).rejects.toThrow('POSIX effective user ID')
    Object.defineProperty(process, 'geteuid', { configurable: true, value: original })
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    await loadCleanupSigningKey()
    const probe = await open(
      join(root, `agent-blackboard-cleanup-${process.geteuid!()}`, 'receipt-hmac-sha256.key'),
      'r',
    )
    const prototype = Object.getPrototypeOf(probe) as { stat: () => Promise<{ ino: number }> }
    await probe.close()
    const originalStat = prototype.stat
    prototype.stat = async function () {
      const info = await originalStat.call(this)
      return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
        ino: Number(info.ino) + 1,
      })
    }
    try {
      await expect(loadCleanupSigningKey()).rejects.toThrow('changed while it was opened')
    } finally {
      prototype.stat = originalStat
    }
  })

  it('swallows staging-file close failures while preserving the parse error', async () => {
    const sourcePath = await temporary(
      'stage-source',
      `${JSON.stringify({ type: 'session', session })}\n{`,
    )
    const directory = await mkdtemp(join(tmpdir(), 'snapshot-stage-'))
    paths.add(directory)
    const source = await open(sourcePath, 'r')
    const probe = await open(sourcePath, 'r')
    const prototype = Object.getPrototypeOf(probe) as { close: () => Promise<void> }
    await probe.close()
    const originalClose = prototype.close
    prototype.close = async function () {
      throw new Error('close failed')
    }
    try {
      await expect(stageSnapshot(source, directory)).rejects.toThrow('invalid JSONL')
    } finally {
      prototype.close = originalClose
      await source.close()
    }
  })

  it('rejects changed partition descriptors, incomplete partitions, and checksum mismatches', async () => {
    const incomplete = await temporary(
      'partition',
      `${JSON.stringify({ type: 'session', session })}\n`,
    )
    const incompleteInfo = await stat(incomplete)
    await expect(validatePartition(incomplete, incompleteInfo)).rejects.toThrow(
      'complete terminal manifest',
    )
    const complete = await temporary(
      'partition',
      `${JSON.stringify({ type: 'session', session })}\n${JSON.stringify({ type: 'manifest', manifest })}\n`,
    )
    const completeInfo = await stat(complete)
    await expect(
      validatePartition(complete, completeInfo, { algorithm: 'sha256', value: 'wrong' }),
    ).rejects.toThrow('checksum')
    const probe = await open(complete, 'r')
    const prototype = Object.getPrototypeOf(probe) as { stat: () => Promise<{ ino: number }> }
    await probe.close()
    const originalStat = prototype.stat
    prototype.stat = async function () {
      const info = await originalStat.call(this)
      return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
        ino: Number(info.ino) + 1,
      })
    }
    try {
      await expect(validatePartition(complete, completeInfo)).rejects.toThrow(
        'changed while it was being removed',
      )
    } finally {
      prototype.stat = originalStat
    }
    const blank = await temporary(
      'partition',
      `${JSON.stringify({ type: 'session', session })}\n\n${JSON.stringify({ type: 'manifest', manifest })}\n`,
    )
    await expect(validatePartition(blank, await stat(blank))).rejects.toThrow('invalid JSONL')
    const afterManifest = await temporary(
      'partition',
      `${JSON.stringify({ type: 'session', session })}\n${JSON.stringify({ type: 'manifest', manifest })}\n${JSON.stringify({ type: 'session', session })}\n`,
    )
    await expect(validatePartition(afterManifest, await stat(afterManifest))).rejects.toThrow(
      'invalid JSONL',
    )
  })

  it('splits an active partition by bytes and swallows an active file close failure', async () => {
    const path = await snapshot(true)
    const first = await partitionSnapshot({ path, maxSessions: 1 })
    paths.add(first.directory)
    const limit = Math.max(...first.partitions.map((partition) => partition.counts.bytes))
    const next = await snapshot(true)
    const split = await partitionSnapshot({ path: next, maxBytes: limit })
    paths.add(split.directory)
    expect(split.partitions).toHaveLength(2)
    const index = join(await mkdtemp(join(tmpdir(), 'partition-index-')), 'index.jsonl')
    paths.add(join(index, '..'))
    await writeFile(
      index,
      `${JSON.stringify({ sessionId: 'bad', path: join(tmpdir(), 'missing'), bytes: 1, sessions: 1, entries: 0 })}\n`,
    )
    await expect(
      writePartitions(index, manifest, await mkdtemp(join(tmpdir(), 'partition-output-')), 1, 1000),
    ).rejects.toThrow()
    const empty = join(await mkdtemp(join(tmpdir(), 'partition-empty-')), 'index.jsonl')
    paths.add(join(empty, '..'))
    await writeFile(empty, '')
    expect(await writePartitions(empty, manifest, join(empty, '..'), 1, 1000)).toEqual([])
  })

  it('rejects mismatched counts and opened snapshots while swallowing a source close failure', async () => {
    await expect(partitionSnapshot({ path: 'relative.jsonl' })).rejects.toThrow('must be absolute')
    const path = await snapshot()
    await expect(
      partitionSnapshot({ path, counts: { bytes: 1, sessions: 1, entries: 0, records: 2 } }),
    ).rejects.toThrow('counts do not match')
    const changed = await snapshot()
    setSnapshotFilesystemForTest({
      open: async (...args) => {
        const file = await open(...args)
        const originalStat = file.stat.bind(file)
        file.stat = async () => {
          const info = await originalStat()
          return Object.assign(Object.create(Object.getPrototypeOf(info)), info, {
            ino: Number(info.ino) + 1,
          })
        }
        return file
      },
    })
    await expect(partitionSnapshot({ path: changed })).rejects.toThrow(
      'changed while it was being opened',
    )
  })
})
