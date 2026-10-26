import { partitionSnapshot } from '../agent-blackboard/index.mts'
import { loadClient } from '../agent-blackboard/client.mts'
import { isObject } from '../agent-blackboard/snapshot-partition-guards.mts'
import type {
  SnapshotChecksum,
  SnapshotCleanupReceipt,
  SnapshotCounts,
  SnapshotPartitionOptions,
} from '../agent-blackboard/snapshot-types.mts'
import { optionalRecord, optionalString, requiredString, type Args } from './args.mts'
import type { ToolHandler } from './context.mts'

const COUNT_KEYS = ['sessions', 'entries', 'records', 'bytes']

function optionalLimit(args: Args, name: string): number | undefined {
  const value = args[name]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`)
  return value
}

function optionalChecksum(args: Args): SnapshotChecksum | undefined {
  const value = optionalString(args, 'checksum')
  if (value === undefined) return undefined
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('checksum must be a sha256 hex digest')
  return { algorithm: 'sha256', value }
}

function optionalCounts(args: Args): SnapshotCounts | undefined {
  const value = optionalRecord(args, 'counts')
  if (value === undefined) return undefined
  const valid =
    Object.keys(value).length === COUNT_KEYS.length &&
    COUNT_KEYS.every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
  if (!valid)
    throw new Error(`counts must hold exactly non-negative integer ${COUNT_KEYS.join(', ')}`)
  return value as SnapshotCounts
}

/**
 * Partitions the snapshot one `snapshot_export` recorded. The caller supplies only the registry
 * token and optional bounds: the path and the blackboard client's own capability come from the
 * server's record, and the partition runs in this process, so the client's temporary-directory
 * check compares the snapshot with this server's directory, never the caller's.
 */
export const snapshotPartition: ToolHandler = async (args, context) => {
  const token = requiredString(args, 'cleanupToken')
  const checksum = optionalChecksum(args)
  const counts = optionalCounts(args)
  const maxSessions = optionalLimit(args, 'maxSessions')
  const maxBytes = optionalLimit(args, 'maxBytes')
  const record = context.snapshots.take(token, context.sessionId, context.worktree)
  try {
    if (record.directory !== undefined)
      throw new Error('this snapshot is already partitioned; clean it up and export again')
    const expectedChecksum = checksum ?? record.checksum
    const expectedCounts = counts ?? record.counts
    const options: SnapshotPartitionOptions = {
      path: record.path,
      ...(expectedChecksum === undefined ? {} : { checksum: expectedChecksum }),
      ...(expectedCounts === undefined ? {} : { counts: expectedCounts }),
      ...(maxSessions === undefined ? {} : { maxSessions }),
      ...(maxBytes === undefined ? {} : { maxBytes }),
    }
    const client = await loadClient(context.dependencies)
    // A client that wrote an ownership marker partitions only with its own capability. An export
    // without one came from an older client, whose partitions the in-tree code splits and signs.
    let result: unknown
    if (record.clientToken === undefined) result = await partitionSnapshot(options)
    else if (client.partitionSnapshot)
      result = await client.partitionSnapshot({ ...options, cleanupToken: record.clientToken })
    else throw new Error('the installed agent-blackboard client cannot partition snapshots')
    if (
      !isObject(result) ||
      typeof result.directory !== 'string' ||
      !Array.isArray(result.partitions)
    )
      throw new Error('agent-blackboard returned an unexpected snapshot partition result')
    const receipt = isObject(result.cleanupReceipt)
      ? (result.cleanupReceipt as SnapshotCleanupReceipt)
      : undefined
    context.snapshots.restore(token, {
      ...record,
      directory: result.directory,
      ...(receipt === undefined ? {} : { receipt }),
    })
    return {
      sessionId: context.sessionId,
      directory: result.directory,
      partitions: result.partitions,
    }
  } catch (error) {
    context.snapshots.restore(token, record)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`snapshot partition failed and the cleanupToken is still valid. ${reason}`, {
      cause: error,
    })
  }
}
