import {
  isTrustedCheckpointComment,
  parseCheckpoint,
  renderCheckpoint,
  type Checkpoint,
  type CheckpointStatus,
  type GitHubComment,
} from './codec.mts'

export type CheckpointUpdateContext = {
  actor: string
  commentId: number
  headRef: string
  headSha: string
  pr: number
  repository: string
  runId: string
  triggerCommentId: number
}

export function updateExactCheckpoint(
  comment: GitHubComment,
  context: CheckpointUpdateContext,
  status: Extract<CheckpointStatus, 'failed' | 'running'>,
  session: { id?: string; url?: string },
): string {
  const checkpoint = parseCheckpoint(comment.body ?? '')
  if (
    !checkpoint ||
    comment.id !== context.commentId ||
    !isTrustedCheckpointComment(comment, context) ||
    checkpoint.actor !== context.actor ||
    checkpoint.repository !== context.repository ||
    checkpoint.pr !== context.pr ||
    checkpoint.triggerCommentId !== context.triggerCommentId ||
    checkpoint.runId !== context.runId ||
    checkpoint.headRef !== context.headRef ||
    checkpoint.startSha !== context.headSha
  ) {
    throw new Error('Checkpoint comment does not match the active run binding')
  }
  if (status === 'running' && (!session.id || !session.url)) {
    throw new Error('Running checkpoint requires a session id and URL')
  }
  if (session.url && (!URL.canParse(session.url) || !session.url.startsWith('https:'))) {
    throw new Error('Session URL must be a parseable https URL')
  }
  const next: Checkpoint = {
    ...checkpoint,
    ...(session.id ? { sessionId: session.id } : {}),
    ...(session.url ? { sessionUrl: session.url } : {}),
    status,
    updatedAt: new Date().toISOString(),
  }
  return renderCheckpoint(next)
}
