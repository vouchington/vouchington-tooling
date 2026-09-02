export const CHECKPOINT_MARKER = 'pr-checkpoint:v1'

export type CheckpointStatus =
  | 'queued'
  | 'running'
  | 'awaiting_verification'
  | 'failed'
  | 'deadline'
  | 'unresumable'
  | 'complete'

export type Checkpoint = {
  marker: string
  repository: string
  pr: number
  /** Absent on checkpoints posted before trigger ids were recorded; keep optional so resume can still parse them. */
  triggerCommentId?: number
  headRef: string
  startSha: string
  sessionStartSha: string
  runId: string
  runUrl: string
  actor: string
  sessionId: string
  /** Absent from v1 checkpoints created before session URLs were exposed. */
  sessionUrl?: string
  resumeSourceRunId: string
  status: CheckpointStatus
  createdAt: string
  updatedAt: string
}

export type GitHubComment = {
  id: number
  user?: { login?: string; type?: string }
  performed_via_github_app?: { slug?: string } | null
  body?: string
  created_at?: string
}

export interface CheckpointCodecOptions {
  marker?: string
  sessionIdPattern?: RegExp
}

export interface TrustedCheckpointActor {
  actor: string
  userType?: string
  appSlug?: string
}

/**
 * Anti-forgery predicate: a checkpoint HTML comment is plain text any PR commenter can paste,
 * so `parseCheckpoint` alone proves shape, not provenance. This proves the comment itself was
 * authored by the expected App identity.
 */
export function isTrustedCheckpointComment(
  comment: GitHubComment,
  context: TrustedCheckpointActor,
): boolean {
  return (
    comment.user?.login === context.actor &&
    comment.user?.type === (context.userType ?? 'Bot') &&
    comment.performed_via_github_app?.slug === (context.appSlug ?? 'github-actions')
  )
}

export function renderCheckpoint(
  checkpoint: Checkpoint,
  options: { marker?: string } = {},
): string {
  const marker = options.marker ?? checkpoint.marker
  const payload = Buffer.from(JSON.stringify({ ...checkpoint, marker }), 'utf8').toString(
    'base64url',
  )
  const session = checkpoint.sessionUrl
    ? `[${checkpoint.sessionId}](${checkpoint.sessionUrl})`
    : `\`${checkpoint.sessionId || 'pending'}\``
  return [
    `👀 [View the automation workflow run](${checkpoint.runUrl}).`,
    '',
    `Status: \`${checkpoint.status}\` · Session: ${session}`,
    '',
    `<!-- ${marker} ${payload} -->`,
  ].join('\n')
}

export function parseCheckpoint(
  body: string,
  options: CheckpointCodecOptions = {},
): Checkpoint | undefined {
  const marker = options.marker ?? CHECKPOINT_MARKER
  const match = body.match(new RegExp(`<!-- ${escapeRegExp(marker)} ([A-Za-z0-9_-]+) -->`, 'u'))
  if (!match?.[1]) return undefined
  try {
    return validateCheckpoint(
      JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')) as unknown,
      options,
    )
  } catch {
    return undefined
  }
}

export function validateCheckpoint(
  value: unknown,
  options: CheckpointCodecOptions = {},
): Checkpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const checkpoint = value as Partial<Checkpoint>
  const marker = options.marker ?? CHECKPOINT_MARKER
  if (
    checkpoint.marker !== marker ||
    !Number.isInteger(checkpoint.pr) ||
    (checkpoint.triggerCommentId !== undefined && !Number.isInteger(checkpoint.triggerCommentId)) ||
    typeof checkpoint.startSha !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(checkpoint.startSha) ||
    typeof checkpoint.sessionStartSha !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(checkpoint.sessionStartSha) ||
    typeof checkpoint.runId !== 'string' ||
    !/^[0-9]+$/u.test(checkpoint.runId) ||
    typeof checkpoint.resumeSourceRunId !== 'string' ||
    (checkpoint.resumeSourceRunId !== '' && !/^[0-9]+$/u.test(checkpoint.resumeSourceRunId)) ||
    typeof checkpoint.repository !== 'string' ||
    typeof checkpoint.headRef !== 'string' ||
    typeof checkpoint.runUrl !== 'string' ||
    typeof checkpoint.actor !== 'string' ||
    typeof checkpoint.sessionId !== 'string' ||
    typeof checkpoint.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(checkpoint.createdAt)) ||
    typeof checkpoint.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(checkpoint.updatedAt)) ||
    typeof checkpoint.status !== 'string' ||
    ![
      'queued',
      'running',
      'awaiting_verification',
      'failed',
      'deadline',
      'unresumable',
      'complete',
    ].includes(checkpoint.status)
  ) {
    return undefined
  }
  if (
    checkpoint.sessionId &&
    options.sessionIdPattern &&
    !matchesPattern(options.sessionIdPattern, checkpoint.sessionId)
  ) {
    return undefined
  }
  if (
    checkpoint.sessionUrl !== undefined &&
    (!URL.canParse(checkpoint.sessionUrl) || !checkpoint.sessionUrl.startsWith('https:'))
  ) {
    return undefined
  }
  return checkpoint as Checkpoint
}

export function sortedCheckpointCandidates(
  comments: GitHubComment[],
  options: CheckpointCodecOptions = {},
): { comment: GitHubComment; checkpoint: Checkpoint }[] {
  return comments
    .map((comment) => ({ comment, checkpoint: parseCheckpoint(comment.body ?? '', options) }))
    .filter(
      (candidate): candidate is { comment: GitHubComment; checkpoint: Checkpoint } =>
        candidate.checkpoint !== undefined,
    )
    .toSorted((left, right) => {
      const timestampOrder = String(right.comment.created_at ?? '').localeCompare(
        String(left.comment.created_at ?? ''),
      )
      return timestampOrder || right.comment.id - left.comment.id
    })
}

function matchesPattern(pattern: RegExp, value: string): boolean {
  return new RegExp(pattern.source, pattern.flags.replaceAll(/[gy]/g, '')).test(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export { selectResumeCheckpoint, type CheckpointSelectionContext } from './resume.mts'
export { updateExactCheckpoint, type CheckpointUpdateContext } from './update.mts'
