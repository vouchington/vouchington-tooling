import { chmod, mkdir, mkdtemp, rename, rm, stat, writeFile, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeCleanupReceipt, serializeCleanupReceipt } from './snapshot-cleanup-receipt.mts'
import {
  loadCleanupSigningKey,
  setCleanupKeyTempDirectoryForTest,
} from './snapshot-cleanup-key.mts'
import { cleanupSnapshotPartitions, partitionSnapshot } from './snapshot.mts'
import { requireResumeReceipt, writeResumeReceipt } from './snapshot-cleanup-resume.mts'
import { setSnapshotCleanupFilesystemForTest } from './snapshot-partition-cleanup.mts'

const paths = new Set<string>()
afterEach(async () => {
  setCleanupKeyTempDirectoryForTest()
  setSnapshotCleanupFilesystemForTest()
  await Promise.all([...paths].map((path) => rm(path, { recursive: true, force: true })))
  paths.clear()
})

function records() {
  const createdAt = '2026-01-01T00:00:00.000Z'
  return [
    {
      type: 'session',
      session: {
        id: 'session:one',
        parentSessionId: null,
        agent: 'codex',
        version: '1',
        createdAt,
        lastEntryAt: null,
        archivedAt: null,
        data: {},
      },
    },
    {
      type: 'manifest',
      manifest: {
        schemaVersion: 1,
        status: 'complete',
        createdAt,
        completedAt: createdAt,
        selection: { archived: false },
        counts: { sessions: 1, entries: 0, records: 2 },
        ordering: {
          sessions: 'createdAt ascending',
          entries: 'createdAt ascending within session',
        },
        consistency: 'best-effort',
      },
    },
  ]
}

async function snapshot(): Promise<string> {
  const path = join(tmpdir(), `agent-blackboard-snapshot-${crypto.randomUUID()}.jsonl`)
  await writeFile(
    path,
    `${records()
      .map((record) => JSON.stringify(record))
      .join('\n')}\n`,
    { mode: 0o400 },
  )
  paths.add(path)
  return path
}

describe('snapshot cleanup guardrails', () => {
  it('rejects missing cleanup targets and malformed receipts without removing anything', async () => {
    await expect(cleanupSnapshotPartitions({})).rejects.toThrow('requires a snapshot')
    await expect(
      cleanupSnapshotPartitions({ path: join(tmpdir(), 'not-generated') }),
    ).rejects.toThrow('generated temporary')
    await expect(
      cleanupSnapshotPartitions({
        directory: join(tmpdir(), 'agent-blackboard-partitions-nope'),
        receipt: {
          schemaVersion: 1,
          directory: 'x',
          directoryDev: 0,
          directoryIno: 0,
          token: 'x',
          partitions: [],
          signature: 'broken',
        },
      }),
    ).rejects.toThrow('signature is invalid')
    await expect(
      cleanupSnapshotPartitions({
        path: join(tmpdir(), `agent-blackboard-snapshot-${crypto.randomUUID()}.jsonl`),
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects non-files and surfaces snapshot stat failures', async () => {
    const directory = join(tmpdir(), `agent-blackboard-snapshot-${crypto.randomUUID()}.jsonl`)
    await mkdir(directory)
    paths.add(directory)
    await expect(cleanupSnapshotPartitions({ path: directory })).rejects.toThrow(
      'not a generated regular file',
    )
    setSnapshotCleanupFilesystemForTest({
      lstat: async () => {
        throw new Error('stat failed')
      },
    })
    await expect(cleanupSnapshotPartitions({ path: await snapshot() })).rejects.toThrow(
      'stat failed',
    )
  })

  it('restores unexpected partition output and refuses a valid receipt for another directory', async () => {
    const path = await snapshot()
    const result = await partitionSnapshot({ path })
    paths.add(result.directory)
    await writeFile(join(result.directory, 'unexpected'), 'keep')
    await expect(
      cleanupSnapshotPartitions({ directory: result.directory, receipt: result.cleanupReceipt }),
    ).rejects.toThrow('unexpected content')
    await expect(stat(join(result.directory, 'unexpected'))).resolves.toBeTruthy()
    await rm(join(result.directory, 'unexpected'))
    const other = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    paths.add(other)
    const otherReceipt = await writeCleanupReceipt(other, result.partitions)
    await expect(
      cleanupSnapshotPartitions({ directory: result.directory, receipt: otherReceipt }),
    ).rejects.toThrow('does not match')
  })

  it('restores a directory whose receipt JSON becomes invalid', async () => {
    const path = await snapshot()
    const result = await partitionSnapshot({ path })
    paths.add(result.directory)
    await chmod(join(result.directory, '.agent-blackboard-cleanup-receipt.json'), 0o600)
    await writeFile(join(result.directory, '.agent-blackboard-cleanup-receipt.json'), '{', {
      mode: 0o400,
    })
    await chmod(join(result.directory, '.agent-blackboard-cleanup-receipt.json'), 0o400)
    await expect(
      cleanupSnapshotPartitions({ directory: result.directory, receipt: result.cleanupReceipt }),
    ).rejects.toThrow('receipt is invalid')
  })

  it('rejects a generated partition directory path replaced by a regular file', async () => {
    const path = await snapshot()
    const result = await partitionSnapshot({ path })
    paths.add(result.directory)
    await rm(result.directory, { recursive: true })
    await writeFile(result.directory, 'replacement')
    await expect(
      cleanupSnapshotPartitions({ directory: result.directory, receipt: result.cleanupReceipt }),
    ).rejects.toThrow('not a generated directory')
  })
})

describe('snapshot cleanup signing-key guards', () => {
  it('rejects non-owner-only directories and keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    const directory = join(root, `agent-blackboard-cleanup-${process.geteuid!()}`)
    await writeFile(directory, 'not a directory')
    await expect(loadCleanupSigningKey()).rejects.toThrow('directory is not owner-only')
    await rm(directory)
    await loadCleanupSigningKey()
    const key = join(directory, 'receipt-hmac-sha256.key')
    await chmod(key, 0o644)
    await expect(loadCleanupSigningKey()).rejects.toThrow('key is not an owner-only')
  })
})

describe('snapshot cleanup receipt and resume edges', () => {
  const checksum = { algorithm: 'sha256' as const, value: 'a'.repeat(64) }
  const receipt = {
    schemaVersion: 1 as const,
    directory: '/tmp/x',
    directoryDev: 1,
    directoryIno: 1,
    token: '00000000-0000-4000-8000-000000000000',
    partitions: [{ name: 'partition-1.jsonl', checksum }],
    signature: 'b'.repeat(64),
  }

  it('rejects malformed partition lists and non-hex signatures before signing', () => {
    expect(() =>
      serializeCleanupReceipt({
        ...receipt,
        partitions: [{ name: 'nope.jsonl', checksum }],
      }),
    ).toThrow('receipt is invalid')
    expect(() =>
      serializeCleanupReceipt({
        ...receipt,
        partitions: [
          { name: 'partition-1.jsonl', checksum },
          { name: 'partition-1.jsonl', checksum },
        ],
      }),
    ).toThrow('receipt is invalid')
    expect(() => serializeCleanupReceipt({ ...receipt, signature: 'zz' })).toThrow(
      'signature is invalid',
    )
  })

  it('rejects a tombstone that lacks resume metadata', async () => {
    const path = await snapshot()
    const result = await partitionSnapshot({ path })
    const tombstone = join(tmpdir(), `.agent-blackboard-cleanup-${result.cleanupReceipt.token}`)
    await rename(result.directory, tombstone)
    paths.add(tombstone)
    await expect(
      cleanupSnapshotPartitions({ directory: result.directory, receipt: result.cleanupReceipt }),
    ).rejects.toThrow('no resume metadata')
  })

  it('surfaces non-ENOENT resume metadata failures during retry', async () => {
    const path = await snapshot()
    const result = await partitionSnapshot({ path })
    paths.add(result.directory)
    await writeResumeReceipt(result.cleanupReceipt)
    const marker = join(
      tmpdir(),
      `.agent-blackboard-cleanup-${result.cleanupReceipt.token}.resume.json`,
    )
    paths.add(marker)
    await chmod(marker, 0o600)
    await writeFile(marker, '{')
    await chmod(marker, 0o400)
    await rm(result.directory, { recursive: true })
    await expect(
      cleanupSnapshotPartitions({ directory: result.directory, receipt: result.cleanupReceipt }),
    ).rejects.toThrow('does not match receipt')
  })

  it('rejects resume cleanup whose receipt directory does not match the missing path', async () => {
    const path = await snapshot()
    const result = await partitionSnapshot({ path })
    await writeResumeReceipt(result.cleanupReceipt)
    const tombstone = join(tmpdir(), `.agent-blackboard-cleanup-${result.cleanupReceipt.token}`)
    const marker = join(
      tmpdir(),
      `.agent-blackboard-cleanup-${result.cleanupReceipt.token}.resume.json`,
    )
    await rename(result.directory, tombstone)
    await rm(join(tombstone, '.agent-blackboard-cleanup-receipt.json'))
    paths.add(tombstone)
    paths.add(marker)
    await expect(
      cleanupSnapshotPartitions({
        directory: join(tmpdir(), 'agent-blackboard-partitions-other'),
        receipt: result.cleanupReceipt,
      }),
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({
          cause: expect.objectContaining({
            message: expect.stringContaining('does not match generated output'),
          }),
        }),
      ],
    })
  })

  it('rejects two-link resume metadata without a matching temporary name', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    paths.add(directory)
    const partition = join(directory, 'partition-1.jsonl')
    await writeFile(partition, 'x', { mode: 0o400 })
    const written = await writeCleanupReceipt(directory, [
      { path: partition, checksum: { algorithm: 'sha256', value: '0'.repeat(64) } },
    ])
    await writeResumeReceipt(written)
    const marker = join(tmpdir(), `.agent-blackboard-cleanup-${written.token}.resume.json`)
    const staging = `${marker}.not-a-uuid.tmp`
    paths.add(marker)
    paths.add(staging)
    await link(marker, staging)
    await expect(requireResumeReceipt(written)).rejects.toThrow('unsafe')
  })
})
