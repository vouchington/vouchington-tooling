import {
  archiveBlackboardSession,
  ensureBlackboardSession,
  exportSnapshot,
  type SnapshotSelection,
} from '../agent-blackboard/index.mts'
import { optionalRecord, optionalString, requiredNullableString, type Args } from './args.mts'
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

export const snapshotExport: ToolHandler = async (args, context) => {
  const selection = readSelection(args)
  return {
    sessionId: context.sessionId,
    ...(await exportSnapshot({
      // An empty selection means "everything"; leave it unset rather than send an empty filter.
      ...(Object.keys(selection).length === 0 ? {} : { selection }),
      env: context.env,
      dependencies: context.dependencies,
    })),
  }
}
