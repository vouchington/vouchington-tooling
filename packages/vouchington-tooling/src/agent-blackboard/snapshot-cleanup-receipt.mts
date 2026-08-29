import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { loadCleanupSigningKey } from './snapshot-cleanup-key.mts'
import type { SnapshotCleanupReceipt, SnapshotPartition } from './snapshot-types.mts'

export const RECEIPT_NAME = '.agent-blackboard-cleanup-receipt.json'

function payload(receipt: Omit<SnapshotCleanupReceipt, 'signature'>): string {
  return JSON.stringify(receipt)
}

export async function writeCleanupReceipt(
  directory: string,
  partitions: Array<Pick<SnapshotPartition, 'path' | 'checksum'>>,
): Promise<SnapshotCleanupReceipt> {
  const info = await lstat(directory)
  const unsigned: Omit<SnapshotCleanupReceipt, 'signature'> = {
    schemaVersion: 1,
    directory,
    directoryDev: info.dev,
    directoryIno: info.ino,
    token: randomUUID(),
    partitions: partitions.map(({ path, checksum }) => ({ name: basename(path), checksum })),
  }
  const signature = createHmac('sha256', await loadCleanupSigningKey())
    .update(payload(unsigned))
    .digest('hex')
  const receipt = { ...unsigned, signature }
  const marker = join(directory, RECEIPT_NAME)
  await writeFile(marker, JSON.stringify(receipt), { flag: 'wx', mode: 0o400 })
  await chmod(marker, 0o400)
  return receipt
}

export async function verifyCleanupReceipt(receipt: SnapshotCleanupReceipt): Promise<void> {
  const { signature, ...unsigned } = receipt
  if (!/^[0-9a-f]{64}$/.test(signature))
    throw new Error('partition directory cleanup receipt signature is invalid')
  const expected = createHmac('sha256', await loadCleanupSigningKey())
    .update(payload(unsigned))
    .digest('hex')
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex')))
    throw new Error('partition directory cleanup receipt signature is invalid')
}
