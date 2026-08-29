import { constants } from 'node:fs'
import { chmod, lstat, mkdtemp, open, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { stageSnapshot } from './snapshot-partition-read.mts'
import { writeCleanupReceipt } from './snapshot-cleanup-receipt.mts'
import { readLines } from './snapshot-partition-io.mts'
import { writePartitions } from './snapshot-partition-write.mts'
import type {
  SnapshotManifest,
  SnapshotPartitionOptions,
  SnapshotPartitionResult,
} from './snapshot-types.mts'

const MAX_SESSIONS = 25
const MAX_BYTES = 1024 * 1024
const SOURCE_NAME = /^agent-blackboard-snapshot-[0-9a-f-]{36}\.jsonl$/
const defaults = { open, mkdtemp, chmod }
let filesystem = defaults
export function setSnapshotFilesystemForTest(overrides?: Partial<typeof defaults>): void {
  filesystem = { ...defaults, ...overrides }
}
function assertLimit(value: number | undefined, fallback: number, label: string): number {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error(`${label} must be a positive integer`)
  return limit
}
function assertGeneratedSnapshot(path: string): void {
  if (!isAbsolute(path)) throw new Error('snapshot path must be absolute')
  if (dirname(resolve(path)) !== resolve(tmpdir()) || !SOURCE_NAME.test(basename(path)))
    throw new Error('snapshot path must be a generated temporary snapshot path')
}
function assertVerification(
  bytes: number,
  checksum: string,
  manifest: SnapshotManifest,
  options: SnapshotPartitionOptions,
): void {
  if (
    options.checksum &&
    (options.checksum.algorithm !== 'sha256' || options.checksum.value !== checksum)
  )
    throw new Error('snapshot checksum does not match')
  if (
    options.counts &&
    (options.counts.bytes !== bytes ||
      options.counts.sessions !== manifest.counts.sessions ||
      options.counts.entries !== manifest.counts.entries ||
      options.counts.records !== manifest.counts.records)
  )
    throw new Error('snapshot counts do not match')
}
async function hashSnapshot(source: FileHandle): Promise<string> {
  const hash = (await import('node:crypto')).createHash('sha256')
  for await (const _line of readLines(source, hash)) {
    // Consume the full descriptor to hash the same source a second time.
  }
  return hash.digest('hex')
}
export async function partitionSnapshot(
  options: SnapshotPartitionOptions,
): Promise<SnapshotPartitionResult> {
  assertGeneratedSnapshot(options.path)
  const before = await lstat(options.path)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
    throw new Error('snapshot path must be an unlinked generated regular file')
  let source: FileHandle | undefined
  let stage: string | undefined
  let directory: string | undefined
  try {
    source = await filesystem.open(options.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    stage = await filesystem.mkdtemp(resolve(tmpdir(), 'agent-blackboard-partition-stage-'))
    directory = await filesystem.mkdtemp(resolve(tmpdir(), 'agent-blackboard-partitions-'))
    const permissions = await Promise.allSettled([
      filesystem.chmod(stage, 0o700),
      filesystem.chmod(directory, 0o700),
    ])
    const permissionFailure = permissions.find((result) => result.status === 'rejected')
    if (permissionFailure?.status === 'rejected') throw permissionFailure.reason
    const opened = await source.stat()
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    )
      throw new Error('snapshot path changed while it was being opened')
    const staged = await stageSnapshot(source, stage)
    const after = await source.stat()
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.nlink !== 1 ||
      opened.size !== staged.bytes ||
      after.size !== staged.bytes
    )
      throw new Error('snapshot path changed while it was being read')
    if ((await hashSnapshot(source)) !== staged.checksum)
      throw new Error('snapshot path changed while it was being read')
    await source.close()
    source = undefined
    assertVerification(staged.bytes, staged.checksum, staged.manifest, options)
    const partitions = await writePartitions(
      staged.index,
      staged.manifest,
      directory,
      assertLimit(options.maxSessions, MAX_SESSIONS, 'maxSessions'),
      assertLimit(options.maxBytes, MAX_BYTES, 'maxBytes'),
    )
    return {
      directory: directory!,
      partitions,
      cleanupReceipt: await writeCleanupReceipt(directory!, partitions),
    }
  } catch (error) {
    if (directory) await rm(directory, { recursive: true, force: true })
    throw error
  } finally {
    await source?.close().catch(() => undefined)
    if (stage) await rm(stage, { recursive: true, force: true })
  }
}
