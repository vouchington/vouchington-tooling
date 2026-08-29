import { randomUUID } from 'node:crypto'
import { link, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadCleanupSigningKey,
  setCleanupKeyTempDirectoryForTest,
} from './snapshot-cleanup-key.mts'
import { requireResumeReceipt, writeResumeReceipt } from './snapshot-cleanup-resume.mts'
import { writeCleanupReceipt } from './snapshot-cleanup-receipt.mts'
import { cleanupSnapshotPartitions } from './snapshot.mts'

const paths = new Set<string>()
afterEach(async () => {
  setCleanupKeyTempDirectoryForTest()
  await Promise.all([...paths].map((path) => rm(path, { recursive: true, force: true })))
  paths.clear()
})

describe('snapshot cleanup publication recovery', () => {
  it('recovers an exact two-link signing-key publication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-key-'))
    paths.add(root)
    setCleanupKeyTempDirectoryForTest(() => root)
    await loadCleanupSigningKey()
    const directory = join(root, `agent-blackboard-cleanup-${process.geteuid!()}`)
    const key = join(directory, 'receipt-hmac-sha256.key')
    const staging = join(directory, `.receipt-hmac-sha256.key.${randomUUID()}`)
    await link(key, staging)
    await expect(loadCleanupSigningKey()).resolves.toHaveLength(32)
    expect((await stat(key)).nlink).toBe(1)
  })

  it('recovers an exact two-link resume publication', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    paths.add(directory)
    const partition = join(directory, 'partition-1.jsonl')
    await writeFile(partition, 'x', { mode: 0o400 })
    const receipt = await writeCleanupReceipt(directory, [
      { path: partition, checksum: { algorithm: 'sha256', value: '0'.repeat(64) } },
    ])
    await writeResumeReceipt(receipt)
    const marker = join(tmpdir(), `.agent-blackboard-cleanup-${receipt.token}.resume.json`)
    paths.add(marker)
    const staging = `${marker}.${randomUUID()}.tmp`
    paths.add(staging)
    await link(marker, staging)
    await expect(requireResumeReceipt(receipt)).resolves.toBeUndefined()
    expect((await stat(marker)).nlink).toBe(1)
  })

  it('accepts a response-lost retry only after every receipt-derived cleanup path is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-blackboard-partitions-'))
    const partition = join(directory, 'partition-1.jsonl')
    await writeFile(partition, 'x', { mode: 0o400 })
    const receipt = await writeCleanupReceipt(directory, [
      { path: partition, checksum: { algorithm: 'sha256', value: '0'.repeat(64) } },
    ])
    await rm(directory, { recursive: true })
    await expect(cleanupSnapshotPartitions({ directory, receipt })).resolves.toBeUndefined()
  })
})
