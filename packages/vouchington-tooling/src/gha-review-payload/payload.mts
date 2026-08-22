/** Maximum serialized review payload accepted at the credential boundary. */
export const MAX_REVIEW_PAYLOAD_BYTES = 256 * 1024
/** Maximum inline comments emitted in one review request. */
export const MAX_REVIEW_COMMENTS = 15

export class ReviewPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewPayloadError'
  }
}

export type ReviewSide = 'LEFT' | 'RIGHT'

export type ReviewComment = {
  path: string
  line: number
  side: ReviewSide
  body: string
  start_line?: number
  start_side?: ReviewSide
}

export type SanitizedReview = {
  event: 'COMMENT'
  commit_id: string
  body: string
  comments: ReviewComment[]
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isCommitId(value: string): boolean {
  return /^[0-9a-f]{40}$/u.test(value)
}

function sanitizeComment(raw: unknown): ReviewComment | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.path !== 'string' || record.path.length === 0 || record.path.includes('\0')) {
    return null
  }
  if (!isPositiveInt(record.line)) return null
  if (record.side !== 'LEFT' && record.side !== 'RIGHT') return null
  if (typeof record.body !== 'string' || record.body.length === 0) return null

  const comment: ReviewComment = {
    path: record.path,
    line: record.line,
    side: record.side,
    body: record.body,
  }
  if (!('start_line' in record)) return comment
  if (!isPositiveInt(record.start_line) || record.start_line > record.line) return null
  if (record.start_side !== 'LEFT' && record.start_side !== 'RIGHT') return null
  comment.start_line = record.start_line
  comment.start_side = record.start_side
  return comment
}

export function reviewCommentSubject(comment: ReviewComment): string {
  const firstLine = comment.body.split('\n', 1)[0] ?? ''
  return `${comment.path}:${comment.line} - ${firstLine}`
}

/**
 * Parses untrusted JSON into the exact review wire shape accepted by the caller's poster.
 * Unknown fields and malformed comments are dropped; the supplied commit id always wins.
 */
export function parseReviewPayload(bytes: Buffer, commitId: string): SanitizedReview {
  if (!isCommitId(commitId)) {
    throw new ReviewPayloadError(
      'commitId must be a 40-character lowercase hexadecimal commit SHA.',
    )
  }
  if (bytes.length === 0 || bytes.length > MAX_REVIEW_PAYLOAD_BYTES) {
    throw new ReviewPayloadError(
      `Payload must be a non-empty JSON object of at most ${MAX_REVIEW_PAYLOAD_BYTES} bytes.`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new ReviewPayloadError('Payload is not valid JSON.')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ReviewPayloadError('Payload must be a JSON object.')
  }
  const record = parsed as Record<string, unknown>
  const body = typeof record.body === 'string' ? record.body : ''
  const rawComments = Array.isArray(record.comments) ? record.comments : []
  const valid = rawComments.flatMap((comment) => {
    const sanitized = sanitizeComment(comment)
    return sanitized ? [sanitized] : []
  })
  const kept = valid.slice(0, MAX_REVIEW_COMMENTS)
  const overflow = valid.slice(MAX_REVIEW_COMMENTS)
  const parts = [body]
  if (overflow.length > 0) {
    parts.push(
      `## Comments over the ${MAX_REVIEW_COMMENTS}-comment cap`,
      ...overflow.map((comment) => `- ${reviewCommentSubject(comment)}`),
    )
  }
  const reviewBody = parts.filter((part) => part.length > 0).join('\n\n')
  if (reviewBody.length === 0 && kept.length === 0) {
    throw new ReviewPayloadError('Payload has no review body and no valid comments.')
  }
  return {
    event: 'COMMENT',
    commit_id: commitId,
    body: reviewBody.length > 0 ? reviewBody : 'Inline findings only.',
    comments: kept,
  }
}

/** Builds the body-only fallback used when inline review placement is rejected. */
export function bodyOnlyReviewFallback(review: SanitizedReview, status: number): SanitizedReview {
  const listed =
    review.comments.length === 0
      ? []
      : [
          '## Inline findings not posted',
          `The inline comments were rejected (HTTP ${status}). The findings were:`,
          ...review.comments.map((comment) => `- ${reviewCommentSubject(comment)}`),
        ]
  const body = [review.body, ...listed].filter((part) => part.length > 0).join('\n\n')
  return {
    event: 'COMMENT',
    commit_id: review.commit_id,
    body: body.length > 0 ? body : `Inline findings not posted (HTTP ${status}).`,
    comments: [],
  }
}
