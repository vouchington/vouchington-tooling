import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertGeneratedPartitionDirectory,
  cleanupSnapshotPartitions,
} from '../agent-blackboard/snapshot-partition-cleanup.mts'
import {
  RECEIPT_NAME,
  verifyCleanupReceipt,
} from '../agent-blackboard/snapshot-cleanup-receipt.mts'
import type { SnapshotCleanupReceipt } from '../agent-blackboard/snapshot-types.mts'

const REJECTED =
  'recoveryDirectory is not a snapshot partition directory this session and worktree generated ' +
  'and this server can still verify; nothing was deleted'
const MAX_MARKER_BYTES = 64 * 1024
const inFlight = new Set<string>()

/** Reads the owner-only receipt marker through a no-follow descriptor, never a followed link. */
async function readMarker(directory: string): Promise<unknown> {
  const marker = join(directory, RECEIPT_NAME)
  const info = await lstat(marker)
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || info.size > MAX_MARKER_BYTES)
    throw new Error('marker is not a regular file')
  const handle = await open(marker, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    return JSON.parse(await handle.readFile('utf8'))
  } finally {
    await handle.close()
  }
}

/**
 * Proves a partition directory is one this server generated for this caller, without any state
 * from before a restart. The directory must be a direct, non-symlink child of the temp directory
 * with the generated name; its marker must carry a valid HMAC signature under the server's
 * persistent key; and the signed owner must equal the caller's sessionId and worktree. Receipts
 * signed without an owner (older ones) are never recoverable.
 */
async function proveOwnership(
  directory: unknown,
  sessionId: string,
  worktree: string,
): Promise<SnapshotCleanupReceipt> {
  if (typeof directory !== 'string') throw new Error('not a path')
  assertGeneratedPartitionDirectory(directory)
  const info = await lstat(directory)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('not a directory')
  const receipt = (await readMarker(directory)) as SnapshotCleanupReceipt
  await verifyCleanupReceipt(receipt)
  const { owner } = receipt
  if (
    receipt.directory !== directory ||
    owner?.sessionId !== sessionId ||
    owner.worktree !== worktree
  )
    throw new Error('not the owner')
  return receipt
}

/**
 * Removes a generated partition directory and its source snapshot after a server restart. The
 * caller's path only selects a candidate; deletion follows the signed receipt and reuses the
 * receipt cleanup's own checks (generated names, temp location, no symlinks, directory identity,
 * partition checksums). Every proof failure is one message, so probing learns nothing. The
 * directory is gone afterward, so a second call is rejected, and a concurrent call is too.
 */
export async function recoverSnapshot(
  directory: unknown,
  sessionId: string,
  worktree: string,
): Promise<void> {
  const key = typeof directory === 'string' ? directory : ''
  if (inFlight.has(key)) throw new Error(REJECTED)
  inFlight.add(key)
  try {
    let receipt: SnapshotCleanupReceipt
    try {
      receipt = await proveOwnership(directory, sessionId, worktree)
    } catch {
      throw new Error(REJECTED)
    }
    await cleanupSnapshotPartitions({
      path: receipt.owner!.source,
      directory: receipt.directory,
      receipt,
    })
  } finally {
    inFlight.delete(key)
  }
}
