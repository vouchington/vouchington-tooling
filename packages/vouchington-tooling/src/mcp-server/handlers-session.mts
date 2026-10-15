import {
  archiveBlackboardSession,
  ensureBlackboardSession,
  exportSnapshot,
  type SnapshotSelection,
} from '../agent-blackboard/index.mts'
import { optionalRecord, optionalString, requiredNullableString, type Args } from './args.mts'
import { isObject } from '../agent-blackboard/snapshot-partition-guards.mts'
import type { SnapshotCleanupReceipt } from '../agent-blackboard/snapshot-types.mts'
import type { SnapshotRecord } from './snapshot-registry.mts'
import { readIdentity, type ToolHandler } from './context.mts'

function readSelection(args: Args): SnapshotSelection {
  const data = optionalRecord(args, 'data')
  const arrays = optionalRecord(args, 'dataArrayContains')
  const inactiveForHours = args.inactiveForHours
  if (
    inactiveForHours !== undefined &&
    (typeof inactiveForHours !== 'number' || !(inactiveForHours > 0))
  )
    throw new Error('inactiveForHours must be a positive number')
  if (arrays !== undefined && Object.values(arrays).some((value) => typeof value !== 'string'))
    throw new Error('dataArrayContains must contain only string values')
  const agent = optionalString(args, 'agent')
  const version = optionalString(args, 'version')
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(version === undefined ? {} : { version }),
    ...(args.parentSessionId === undefined
      ? {}
      : { parentSessionId: requiredNullableString(args, 'parentSessionId') }),
    ...(data === undefined ? {} : { data }),
    ...(arrays === undefined ? {} : { dataArrayContains: arrays as Record<string, string> }),
    ...(inactiveForHours === undefined ? {} : { inactiveForHours }),
  }
}

export const sessionEnsure: ToolHandler = async (args, context) =>
  ensureBlackboardSession({
    ...readIdentity(args, context.sessionId),
    env: context.env,
    dependencies: context.dependencies,
  })

export const sessionArchive: ToolHandler = async (_args, context) =>
  archiveBlackboardSession({
    sessionId: context.sessionId,
    env: context.env,
    dependencies: context.dependencies,
  })

/** A partition directory and signed receipt, only when the client itself reported both. */
function recordedPartitions(outcome: object): Partial<SnapshotRecord> {
  const { directory, cleanupReceipt } = outcome as Record<string, unknown>
  return typeof directory === 'string' && isObject(cleanupReceipt)
    ? { directory, receipt: cleanupReceipt as SnapshotCleanupReceipt }
    : {}
}

export const snapshotExport: ToolHandler = async (args, context) => {
  const selection = readSelection(args)
  const outcome = await exportSnapshot({
    // An empty selection means "everything"; leave it unset rather than send an empty filter.
    ...(Object.keys(selection).length === 0 ? {} : { selection }),
    env: context.env,
    dependencies: context.dependencies,
  })
  // The client's own token is dropped: the server records the export and mints a token bound to
  // the caller's sessionId and worktree, which `snapshot_cleanup` checks before touching disk.
  const { cleanupToken: _clientToken, ...reported } = outcome
  return {
    sessionId: context.sessionId,
    ...reported,
    cleanupToken: context.snapshots.register({
      sessionId: context.sessionId,
      worktree: context.worktree,
      path: outcome.path,
      ...recordedPartitions(outcome),
    }),
  }
}
