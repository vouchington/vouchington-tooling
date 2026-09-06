import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { loadCleanupSigningKey } from './snapshot-cleanup-key.mts'
import type { SnapshotCleanupReceipt, SnapshotPartition } from './snapshot-types.mts'

export const RECEIPT_NAME = '.agent-blackboard-cleanup-receipt.json'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value)
}
function canonical(receipt: unknown, signature: boolean): string {
  if (
    !record(receipt) ||
    !exact(
      receipt,
      signature
        ? [
            'schemaVersion',
            'directory',
            'directoryDev',
            'directoryIno',
            'token',
            'partitions',
            'signature',
          ]
        : ['schemaVersion', 'directory', 'directoryDev', 'directoryIno', 'token', 'partitions'],
    )
  )
    throw new Error('partition directory cleanup receipt is invalid')
  const { schemaVersion, directory, directoryDev, directoryIno, token, partitions } = receipt
  if (
    schemaVersion !== 1 ||
    typeof directory !== 'string' ||
    !directory ||
    !Number.isSafeInteger(directoryDev as number) ||
    (directoryDev as number) < 0 ||
    !Number.isSafeInteger(directoryIno as number) ||
    (directoryIno as number) < 0 ||
    typeof token !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(token) ||
    !Array.isArray(partitions)
  )
    throw new Error('partition directory cleanup receipt is invalid')
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- retain the validated numeric type after runtime receipt checks
  const normalizedDirectoryDev = directoryDev as number
  // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- retain the validated numeric type after runtime receipt checks
  const normalizedDirectoryIno = directoryIno as number
  const normalized = partitions.map((partition) => {
    if (
      !record(partition) ||
      !exact(partition, ['name', 'checksum']) ||
      typeof partition.name !== 'string' ||
      !/^partition-[1-9][0-9]*\.jsonl$/.test(partition.name) ||
      !record(partition.checksum) ||
      !exact(partition.checksum, ['algorithm', 'value']) ||
      partition.checksum.algorithm !== 'sha256' ||
      typeof partition.checksum.value !== 'string' ||
      !/^[0-9a-f]{64}$/.test(partition.checksum.value)
    )
      throw new Error('partition directory cleanup receipt is invalid')
    return {
      name: partition.name,
      checksum: { algorithm: 'sha256', value: partition.checksum.value },
    }
  })
  if (new Set(normalized.map(({ name }) => name)).size !== normalized.length)
    throw new Error('partition directory cleanup receipt is invalid')
  const unsigned = {
    schemaVersion: 1,
    directory,
    directoryDev: normalizedDirectoryDev,
    directoryIno: normalizedDirectoryIno,
    token,
    partitions: normalized,
  }
  if (!signature) return JSON.stringify(unsigned)
  if (typeof receipt.signature !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.signature))
    throw new Error('partition directory cleanup receipt signature is invalid')
  return JSON.stringify({ ...unsigned, signature: receipt.signature })
}
function payload(receipt: Omit<SnapshotCleanupReceipt, 'signature'>): string {
  return canonical(receipt, false)
}

export function serializeCleanupReceipt(receipt: SnapshotCleanupReceipt): string {
  return canonical(receipt, true)
}
export function sameCleanupReceipt(left: unknown, right: SnapshotCleanupReceipt): boolean {
  try {
    return (
      serializeCleanupReceipt(left as SnapshotCleanupReceipt) === serializeCleanupReceipt(right)
    )
  } catch {
    return false
  }
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
  await writeFile(marker, serializeCleanupReceipt(receipt), { flag: 'wx', mode: 0o400 })
  await chmod(marker, 0o400)
  return receipt
}

export async function verifyCleanupReceipt(receipt: SnapshotCleanupReceipt): Promise<void> {
  if (
    !record(receipt) ||
    typeof receipt.signature !== 'string' ||
    !/^[0-9a-f]{64}$/.test(receipt.signature)
  )
    throw new Error('partition directory cleanup receipt signature is invalid')
  const serialized = serializeCleanupReceipt(receipt)
  const { signature, ...unsigned } = JSON.parse(serialized) as SnapshotCleanupReceipt
  const expected = createHmac('sha256', await loadCleanupSigningKey())
    .update(payload(unsigned))
    .digest('hex')
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex')))
    throw new Error('partition directory cleanup receipt signature is invalid')
}
