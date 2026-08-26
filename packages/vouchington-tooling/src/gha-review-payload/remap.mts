import { ReviewPayloadError, type ReviewComment, type SanitizedReview } from './payload.mts'
import type { CommentableIndex, LineKind } from './diff.mts'

export function snapReviewNote(path: string, line: number): string {
  return `_Regarding \`${path}:${line}\` (not in the diff hunk; posted on the nearest commentable line)._`
}

export function rewriteSnappedSuggestion(body: string): string {
  return body.replace(/```suggestion\b/gu, '```')
}

function otherSide(side: ReviewComment['side']): ReviewComment['side'] {
  return side === 'LEFT' ? 'RIGHT' : 'LEFT'
}

export function nearestReviewLine(
  candidates: Array<{ line: number; kind: LineKind }>,
  line: number,
): { line: number; kind: LineKind } | undefined {
  if (candidates.length === 0) return undefined
  return candidates.reduce((best, current) => {
    const bestDist = Math.abs(best.line - line)
    const currentDist = Math.abs(current.line - line)
    if (currentDist !== bestDist) return currentDist < bestDist ? current : best
    const currentChanged = current.kind !== 'context'
    const bestChanged = best.kind !== 'context'
    if (currentChanged !== bestChanged) return currentChanged ? current : best
    return current.line > best.line ? current : best
  })
}

function withSnap(
  comment: ReviewComment,
  originalPath: string,
  originalLine: number,
): ReviewComment {
  const body = `${snapReviewNote(originalPath, originalLine)}\n\n${rewriteSnappedSuggestion(comment.body)}`
  return { ...comment, body }
}

function withoutRange(comment: ReviewComment): ReviewComment {
  return {
    path: comment.path,
    line: comment.line,
    side: comment.side,
    body: comment.body,
  }
}

function placeComment(comment: ReviewComment, index: CommentableIndex): ReviewComment | null {
  const resolved = index.resolvePath(comment.path)
  if (resolved === undefined || !index.hasPatch(resolved)) return null
  const originalPath = comment.path
  const originalLine = comment.line
  const placed: ReviewComment = { ...comment, path: resolved }
  const rangeOk =
    placed.start_line === undefined ||
    (placed.start_side !== undefined &&
      index.has(resolved, placed.start_side, placed.start_line) &&
      index.has(resolved, placed.side, placed.line))
  const target = rangeOk ? placed : withoutRange(placed)
  if (index.has(resolved, target.side, target.line)) {
    return target
  }
  const alt = otherSide(target.side)
  if (index.has(resolved, alt, target.line)) {
    return withSnap({ ...target, side: alt }, originalPath, originalLine)
  }
  const near = nearestReviewLine(index.candidates(resolved, target.side), target.line)
  if (near) return withSnap({ ...target, line: near.line }, originalPath, originalLine)
  const nearAlt = nearestReviewLine(index.candidates(resolved, alt), target.line)
  if (nearAlt)
    return withSnap({ ...target, side: alt, line: nearAlt.line }, originalPath, originalLine)
  return null
}

/** Places every finding on a commentable diff line and fails if any finding cannot be placed. */
export function remapReviewComments(
  review: SanitizedReview,
  index: CommentableIndex,
): SanitizedReview {
  const kept: ReviewComment[] = []
  for (const comment of review.comments) {
    const placed = placeComment(comment, index)
    if (!placed) {
      throw new ReviewPayloadError(
        `Inline finding cannot be placed on the pull request diff: ${comment.path}:${comment.line}.`,
      )
    }
    kept.push(placed)
  }
  return {
    ...review,
    body: review.body.length > 0 ? review.body : 'Inline findings only.',
    comments: kept,
  }
}
