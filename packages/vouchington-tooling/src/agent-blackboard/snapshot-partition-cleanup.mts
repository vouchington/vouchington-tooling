import { randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { verifyCleanupReceipt } from './snapshot-cleanup-receipt.mts'
import { removePartitionDirectory } from './snapshot-cleanup-directory.mts'
import {
  removeResumeReceipt,
  requireResumeReceipt,
  writeResumeReceipt,
} from './snapshot-cleanup-resume.mts'
import type { SnapshotCleanupOptions, SnapshotCleanupReceipt } from './snapshot-types.mts'

const SOURCE_NAME = /^agent-blackboard-snapshot-[0-9a-f-]{36}\.jsonl$/
const DIRECTORY_NAME = /^agent-blackboard-partitions-[A-Za-z0-9]+$/
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && directory && receipt)
      return resumeDirectory(path, receipt)
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
  const tombstone =
    directory && receipt
      ? tombstonePath(receipt)
      : join(tmpdir(), `.agent-blackboard-cleanup-${process.pid}-${randomUUID()}`)
  if (directory) await writeResumeReceipt(optionsReceipt(receipt))
  await filesystem.rename(path, tombstone)
  let deleting = false
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
    if (directory)
      await removePartitionDirectory(
        filesystem,
        tombstone,
        path,
        optionsReceipt(receipt),
        captured,
        false,
        () => {
          deleting = true
        },
      )
    else await filesystem.rm(tombstone, { force: true })
  } catch (error) {
    if (directory && deleting)
      throw new Error(`${label} cleanup failed; retained tombstone ${tombstone} for retry`, {
        cause: error,
      })
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
function tombstonePath(receipt: SnapshotCleanupReceipt): string {
  return join(tmpdir(), `.agent-blackboard-cleanup-${receipt.token}`)
}
async function resumeDirectory(path: string, receipt: SnapshotCleanupReceipt): Promise<void> {
  const tombstone = tombstonePath(receipt)
  let marker = true
  try {
    await requireResumeReceipt(receipt)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    marker = false
  }
  let info
  try {
    info = await filesystem.lstat(tombstone)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (marker) await removeResumeReceipt(receipt)
    return
  }
  if (!marker) throw new Error('partition directory tombstone has no resume metadata')
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('partition directory tombstone is unsafe')
  try {
    await removePartitionDirectory(
      filesystem,
      tombstone,
      path,
      receipt,
      info,
      true,
      () => undefined,
    )
  } catch (error) {
    throw new Error(
      `partition directory cleanup failed; retained tombstone ${tombstone} for retry`,
      { cause: error },
    )
  }
}
function optionsReceipt(receipt: SnapshotCleanupReceipt | undefined): SnapshotCleanupReceipt {
  if (!receipt) throw new Error('partition directory cleanup requires a receipt')
  return receipt
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
