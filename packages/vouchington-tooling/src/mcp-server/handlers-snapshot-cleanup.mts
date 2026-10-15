import { cleanupSnapshotPartitions } from '../agent-blackboard/index.mts'
import { requiredString } from './args.mts'
import type { ToolHandler } from './context.mts'

/**
 * Deletes the files one `snapshot_export` recorded. The caller supplies only the token: the paths
 * and the signed receipt come from the server's own record, and the record is checked against the
 * caller's sessionId and resolved worktree before any filesystem call.
 */
export const snapshotCleanup: ToolHandler = async (args, context) => {
  const token = requiredString(args, 'cleanupToken')
  // Taking the record is synchronous, so a concurrent second call finds the token already spent.
  const record = context.snapshots.take(token, context.sessionId, context.worktree)
  try {
    await cleanupSnapshotPartitions({
      path: record.path,
      ...(record.directory === undefined ? {} : { directory: record.directory }),
      ...(record.receipt === undefined ? {} : { receipt: record.receipt }),
    })
  } catch (error) {
    context.snapshots.restore(token, record)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `snapshot cleanup failed and the cleanupToken is still valid; retry the same call. ${reason}`,
      { cause: error },
    )
  }
  return { sessionId: context.sessionId, cleaned: true }
}
