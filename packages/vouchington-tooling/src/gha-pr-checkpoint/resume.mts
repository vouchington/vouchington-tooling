import {
  isTrustedCheckpointComment,
  sortedCheckpointCandidates,
  type Checkpoint,
  type GitHubComment,
} from './index.mts'

export type CheckpointSelectionContext = {
  repository: string
  pr: number
  headRef: string
  headSha: string
  actor: string
  isAncestor: (candidate: string, head: string) => boolean
  isShepherdRun: (runId: string) => boolean
}

export function selectResumeCheckpoint(
  comments: GitHubComment[],
  context: CheckpointSelectionContext,
): { checkpoint: Checkpoint; commentId: number } | undefined {
  const candidates = sortedCheckpointCandidates(comments)
  for (const { comment, checkpoint } of candidates) {
    if (
      !isTrustedCheckpointComment(comment, context) ||
      checkpoint.actor !== context.actor ||
      checkpoint.repository !== context.repository ||
      checkpoint.pr !== context.pr ||
      checkpoint.headRef !== context.headRef ||
      !checkpoint.sessionId ||
      !context.isShepherdRun(checkpoint.runId) ||
      !context.isAncestor(checkpoint.startSha, context.headSha) ||
      !context.isAncestor(checkpoint.sessionStartSha, context.headSha)
    ) {
      continue
    }
    if (checkpoint.status === 'complete' || checkpoint.status === 'unresumable') return undefined
    return { checkpoint, commentId: comment.id }
  }
  return undefined
}
