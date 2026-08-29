import { lstat, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { RECEIPT_NAME, verifyCleanupReceipt } from './snapshot-cleanup-receipt.mts'
import { assertPartitionFile, validatePartition } from './snapshot-partition-validate.mts'
import type { SnapshotCleanupOptions, SnapshotCleanupReceipt } from './snapshot-types.mts'

const SOURCE_NAME = /^agent-blackboard-snapshot-[0-9a-f-]{36}\.jsonl$/
const DIRECTORY_NAME = /^agent-blackboard-partitions-[A-Za-z0-9]+$/
const PARTITION = /^partition-([1-9][0-9]*)\.jsonl$/
const defaults = { lstat, readFile, readdir, rename, rm, rmdir }
let filesystem = defaults

export function setSnapshotCleanupFilesystemForTest(overrides?: Partial<typeof defaults>): void {
  filesystem = { ...defaults, ...overrides }
}

function assertGeneratedPath(path: string, expression: RegExp, label: string): void {
  if (
    !isAbsolute(path) ||
    dirname(resolve(path)) !== resolve(tmpdir()) ||
    !expression.test(basename(path))
  )
    throw new Error(`${label} must be a generated temporary ${label}`)
}
async function removeCaptured(
  path: string,
  expression: RegExp,
  directory: boolean,
  receipt?: SnapshotCleanupReceipt,
): Promise<void> {
  const label = directory ? 'partition directory' : 'snapshot path'
  assertGeneratedPath(path, expression, label)
  let initial
  try {
    initial = await filesystem.lstat(path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (
    initial.isSymbolicLink() ||
    (!initial.isFile() && !directory) ||
    (directory && !initial.isDirectory()) ||
    (!directory && initial.nlink !== 1)
  )
    throw new Error(`${label} is not a generated ${directory ? 'directory' : 'regular file'}`)
  const tombstone = join(
    tmpdir(),
    `.agent-blackboard-cleanup-${process.pid}-${crypto.randomUUID()}`,
  )
  await filesystem.rename(path, tombstone)
  try {
    const captured = await filesystem.lstat(tombstone)
    if (
      captured.isSymbolicLink() ||
      captured.dev !== initial.dev ||
      captured.ino !== initial.ino ||
      captured.isDirectory() !== directory ||
      (!directory && (!captured.isFile() || captured.nlink !== 1))
    )
      throw new Error(`${label} changed while it was being removed`)
    if (directory) await removeDirectory(tombstone, path, optionsReceipt(receipt), captured)
    else await filesystem.rm(tombstone, { force: true })
  } catch (error) {
    try {
      await filesystem.rename(tombstone, path)
    } catch (rollback) {
      throw new AggregateError(
        [error, rollback],
        `${label} cleanup failed; tombstone ${tombstone} could not be restored to ${path}`,
      )
    }
    const detail = error instanceof Error ? `: ${error.message}` : ''
    throw new Error(`${label} cleanup failed; restored ${path} for retry${detail}`, {
      cause: error,
    })
  }
}
function optionsReceipt(receipt: SnapshotCleanupReceipt | undefined): SnapshotCleanupReceipt {
  if (!receipt) throw new Error('partition directory cleanup requires a receipt')
  return receipt
}
async function removeDirectory(
  path: string,
  originalPath: string,
  receipt: SnapshotCleanupReceipt,
  directory: Awaited<ReturnType<typeof lstat>>,
): Promise<void> {
  const names = await filesystem.readdir(path)
  const ordered = names
    .filter((name) => PARTITION.test(name))
    .map((name) => ({ name, number: Number(PARTITION.exec(name)?.[1]) }))
    .sort((left, right) => left.number - right.number)
  if (
    ordered.some(({ number }, index) => number !== index + 1) ||
    names.length !== receipt.partitions.length + 1 ||
    !names.includes(RECEIPT_NAME)
  )
    throw new Error('partition directory contains unexpected content')
  await validateReceipt(
    originalPath,
    path,
    receipt,
    directory,
    ordered.map(({ name }) => name),
  )
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
  for (const { name } of ordered) {
    const file = join(path, name)
    await filesystem.rm(file, { force: false })
  }
  await filesystem.rm(join(path, RECEIPT_NAME), { force: false })
  await filesystem.rmdir(path)
}
async function validateReceipt(
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
  if (
    JSON.stringify(parsed) !== JSON.stringify(receipt) ||
    receipt.schemaVersion !== 1 ||
    receipt.directory !== originalPath ||
    receipt.directoryDev !== directory.dev ||
    receipt.directoryIno !== directory.ino ||
    receipt.partitions.length !== names.length ||
    receipt.partitions.some(
      ({ name, checksum }, index) =>
        name !== names[index] || checksum.algorithm !== 'sha256' || !checksum.value,
    )
  )
    throw new Error('partition directory cleanup receipt does not match generated output')
}
export async function cleanupSnapshotPartitions(options: SnapshotCleanupOptions): Promise<void> {
  if (!options.path && !options.directory)
    throw new Error('cleanup requires a snapshot path or partition directory')
  if (options.directory) await verifyCleanupReceipt(optionsReceipt(options.receipt))
  const results = await Promise.allSettled([
    ...(options.path ? [removeCaptured(options.path, SOURCE_NAME, false)] : []),
    ...(options.directory
      ? [removeCaptured(options.directory, DIRECTORY_NAME, true, options.receipt)]
      : []),
  ])
  const failures = results.filter((result) => result.status === 'rejected')
  if (failures.length) {
    const reasons = failures.map((result) => String(result.reason)).join('; ')
    throw new AggregateError(
      failures.map((result) => result.reason),
      `snapshot cleanup failed: ${reasons}`,
    )
  }
}
