import type { lstat, readFile, readdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { RECEIPT_NAME, sameCleanupReceipt } from './snapshot-cleanup-receipt.mts'
import { removeResumeReceipt, writeResumeReceipt } from './snapshot-cleanup-resume.mts'
import { assertPartitionFile, validatePartition } from './snapshot-partition-validate.mts'
import type { SnapshotCleanupReceipt } from './snapshot-types.mts'

const PARTITION = /^partition-([1-9][0-9]*)\.jsonl$/
type Filesystem = {
  lstat: typeof lstat
  readFile: typeof readFile
  readdir: typeof readdir
  rm: typeof rm
  rmdir: typeof rmdir
}

export async function removePartitionDirectory(
  filesystem: Filesystem,
  path: string,
  originalPath: string,
  receipt: SnapshotCleanupReceipt,
  directory: Awaited<ReturnType<typeof lstat>>,
  resume: boolean,
  startDeleting: () => void,
): Promise<void> {
  const names = await filesystem.readdir(path)
  const ordered = names
    .filter((name) => PARTITION.test(name))
    .map((name) => ({ name, number: Number(PARTITION.exec(name)?.[1]) }))
    .sort((left, right) => left.number - right.number)
  const expected = receipt.partitions.map(({ name }) => name)
  const remaining = expected.slice(expected.length - ordered.length)
  const hasReceipt = names.includes(RECEIPT_NAME)
  if (
    (!hasReceipt && !resume) ||
    names.length !== ordered.length + Number(hasReceipt) ||
    ordered.some(({ name }, index) => name !== remaining[index]) ||
    (!resume && ordered.length !== expected.length)
  )
    throw new Error('partition directory contains unexpected content')
  const partitionNames = ordered.map(({ name }) => name)
  if (hasReceipt)
    await validateReceipt(filesystem, originalPath, path, receipt, directory, partitionNames)
  else validateReceiptOutput(originalPath, receipt, directory, partitionNames)
  for (const { name } of ordered) {
    const file = join(path, name)
    const info = await filesystem.lstat(file)
    assertPartitionFile(info)
    await validatePartition(
      file,
      info,
      receipt.partitions.find((partition) => partition.name === name)?.checksum,
    )
  }
  if (!resume) await writeResumeReceipt(receipt)
  startDeleting()
  for (const { name } of ordered) await filesystem.rm(join(path, name), { force: false })
  if (hasReceipt) await filesystem.rm(join(path, RECEIPT_NAME), { force: false })
  await filesystem.rmdir(path)
  await removeResumeReceipt(receipt)
}

async function validateReceipt(
  filesystem: Pick<Filesystem, 'lstat' | 'readFile'>,
  originalPath: string,
  path: string,
  receipt: SnapshotCleanupReceipt,
  directory: Awaited<ReturnType<typeof lstat>>,
  names: string[],
): Promise<void> {
  const marker = join(path, RECEIPT_NAME)
  const info = await filesystem.lstat(marker)
  assertPartitionFile(info)
  let parsed: unknown
  try {
    parsed = JSON.parse(await filesystem.readFile(marker, 'utf8'))
  } catch {
    throw new Error('partition directory cleanup receipt is invalid')
  }
  if (!sameCleanupReceipt(parsed, receipt))
    throw new Error('partition directory cleanup receipt does not match generated output')
  validateReceiptOutput(originalPath, receipt, directory, names)
}
function validateReceiptOutput(
  originalPath: string,
  receipt: SnapshotCleanupReceipt,
  directory: Awaited<ReturnType<typeof lstat>>,
  names: string[],
): void {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.directory !== originalPath ||
    receipt.directoryDev !== directory.dev ||
    receipt.directoryIno !== directory.ino ||
    receipt.partitions.filter(({ name }) => names.includes(name)).length !== names.length ||
    receipt.partitions
      .filter(({ name }) => names.includes(name))
      .some(
        ({ name, checksum }, index) =>
          name !== names[index] || checksum.algorithm !== 'sha256' || !checksum.value,
      )
  )
    throw new Error('partition directory cleanup receipt does not match generated output')
}
