import {
  loadClient,
  resolveBlackboardConnection,
  type BlackboardClientDependencies,
} from './client.mts'
import { validateFeedbackIdentity } from './feedback-identity.mts'
import { assertSessionId } from './session-id.mts'
import { isObject } from './snapshot-partition-guards.mts'
import type { FeedbackIdentity } from './feedback-types.mts'
import type {
  SnapshotChecksum,
  SnapshotCounts,
  SnapshotManifest,
  SnapshotSelection,
} from './snapshot-types.mts'

type ClientOptions = { env?: NodeJS.ProcessEnv; dependencies?: BlackboardClientDependencies }

export type EnsureSessionOutcome = {
  sessionId: string
  status: 'created' | 'exists'
  archived: boolean
}

export type SnapshotExportOutcome = {
  path: string
  counts: SnapshotCounts
  checksum: SnapshotChecksum
  manifest: SnapshotManifest
  cleanupToken?: string
}

const UPGRADE_HINT = 'upgrade agent-blackboard in the consumer package'

/** Idempotently creates the session; an existing session must match the supplied identity. */
export async function ensureBlackboardSession(
  input: FeedbackIdentity & ClientOptions,
): Promise<EnsureSessionOutcome> {
  const { sessionId, parentSessionId, agent, version } = input
  validateFeedbackIdentity({ sessionId, parentSessionId, agent, version })
  const { Sessions } = await loadClient(input.dependencies)
  const { status, session } = await new Sessions(resolveBlackboardConnection(input.env)).ensure({
    id: sessionId,
    parentSessionId,
    agent,
    version,
  })
  return { sessionId, status, archived: session.archivedAt != null }
}

/** Marks a session distilled. Metadata becomes immutable; entries stay appendable. */
export async function archiveBlackboardSession(
  input: { sessionId: string } & ClientOptions,
): Promise<{ sessionId: string; archived: true }> {
  assertSessionId(input.sessionId)
  const { Sessions } = await loadClient(input.dependencies)
  const sessions = new Sessions(resolveBlackboardConnection(input.env))
  if (typeof sessions.archive !== 'function')
    throw new Error(
      `the installed agent-blackboard client cannot archive sessions; ${UPGRADE_HINT}`,
    )
  await sessions.archive(input.sessionId)
  return { sessionId: input.sessionId, archived: true }
}

/**
 * Exports a snapshot into a private file the client generates. Callers cannot choose the
 * destination, so a long-lived process with credentials never writes to an agent-chosen path.
 */
export async function exportSnapshot(
  input: { selection?: SnapshotSelection } & ClientOptions,
): Promise<SnapshotExportOutcome> {
  const { Snapshots } = await loadClient(input.dependencies)
  if (!Snapshots)
    throw new Error(
      `the installed agent-blackboard client cannot export snapshots; ${UPGRADE_HINT}`,
    )
  const result = await new Snapshots(resolveBlackboardConnection(input.env)).export(
    input.selection === undefined ? {} : { selection: input.selection },
  )
  if (!isObject(result) || typeof result.path !== 'string')
    throw new Error('agent-blackboard returned an unexpected snapshot export result')
  return result as SnapshotExportOutcome
}
