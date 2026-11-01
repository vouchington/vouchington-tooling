import { GITHUB_BODY_MAX_CHARACTERS } from '../gh-cli/body-length.mts'
import {
  placeReviewComment,
  type CommentableIndex,
  type ReviewComment,
  type SanitizedReview,
} from '../gha-review-payload/index.mts'
import type { FinalReviewInput, Finding } from './finding.mts'
import { renderBodyFinding, renderFindingBody, renderHeader, sortFindings } from './render.mts'

export type BuildLimits = {
  /** Inline comments per posted review; larger reviews are split into parts. */
  maxComments: number
  /** Characters per review body, kept under GitHub's limit. */
  maxBodyChars: number
}

export const DEFAULT_LIMITS: BuildLimits = {
  maxComments: 50,
  maxBodyChars: GITHUB_BODY_MAX_CHARACTERS - 1_536,
}

const TRUNCATED = '\n\n_(truncated to fit GitHub limits)_'
const OFF_DIFF_HEADING = '### Not on a diff line'

function toComment(finding: Finding): ReviewComment | null {
  if (finding.path === undefined || finding.line === undefined) return null
  const side = finding.side ?? 'RIGHT'
  const comment: ReviewComment = {
    path: finding.path,
    line: finding.line,
    side,
    body: renderFindingBody(finding),
  }
  if (finding.startLine === undefined) return comment
  return { ...comment, start_line: finding.startLine, start_side: side }
}

/** Splits findings into placed inline comments and blocks for the review body. */
export function placeFindings(
  findings: readonly Finding[],
  index: CommentableIndex,
): { comments: ReviewComment[]; offDiff: Finding[] } {
  const comments: ReviewComment[] = []
  const offDiff: Finding[] = []
  for (const finding of sortFindings(findings)) {
    const comment = toComment(finding)
    const placed = comment === null ? null : placeReviewComment(comment, index)
    if (placed === null) offDiff.push(finding)
    else comments.push(placed)
  }
  return { comments, offDiff }
}

function fit(block: string, max: number): string {
  if (block.length <= max) return block
  return `${block.slice(0, Math.max(0, max - TRUNCATED.length))}${TRUNCATED}`
}

/** Greedily packs blocks into bodies; the first body starts with `first`. */
export function packBodies(first: string, blocks: readonly string[], max: number): string[] {
  const bodies = [fit(first, max)]
  for (const raw of blocks) {
    const block = fit(raw, max)
    const last = bodies.length - 1
    const joined = `${bodies[last]}\n\n${block}`
    if (joined.length <= max) bodies[last] = joined
    else bodies.push(block)
  }
  return bodies
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size))
  }
  return chunks
}

function partHeader(headSha: string, part: number, total: number): string {
  return `<!-- final-review-part sha=${headSha} part=${part} -->\n**Final review, part ${part} of ${total}** · \`${headSha.slice(0, 12)}\``
}

/**
 * Builds one or more COMMENT reviews for GitHub. Placeable findings become inline comments, the
 * rest go in the body, and anything over the limits continues in additional review parts.
 */
export function buildFinalReviews(
  input: FinalReviewInput,
  headSha: string,
  index: CommentableIndex,
  limits: BuildLimits = DEFAULT_LIMITS,
): SanitizedReview[] {
  const { comments, offDiff } = placeFindings(input.findings, index)
  const header = renderHeader(input, headSha)
  const blocks = offDiff.length === 0 ? [] : [OFF_DIFF_HEADING, ...offDiff.map(renderBodyFinding)]
  const bodyMax = limits.maxBodyChars - 200
  const bodies = packBodies(header, blocks, bodyMax)
  const commentChunks = chunk(comments, limits.maxComments)
  const total = Math.max(bodies.length, commentChunks.length)
  const reviews: SanitizedReview[] = []
  for (let part = 0; part < total; part += 1) {
    const body = bodies[part]
    const prefix = part === 0 ? '' : `${partHeader(headSha, part + 1, total)}\n\n`
    reviews.push({
      event: 'COMMENT',
      commit_id: headSha,
      body: `${prefix}${body ?? 'Inline findings continued.'}`,
      comments: commentChunks[part] ?? [],
    })
  }
  return reviews
}
