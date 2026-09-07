import {
  ReviewPayloadError,
  indexReviewFiles,
  parseReviewPayload,
  remapReviewComments,
  type ReviewFile,
  type SanitizedReview,
} from '../gha-review-payload/index.mts'

export {
  // oxlint-disable-next-line no-mistakes/ts-no-export-renaming -- preserve the package's established public compatibility name
  MAX_REVIEW_COMMENTS as MAX_COMMENTS,
  // oxlint-disable-next-line no-mistakes/ts-no-export-renaming -- preserve the package's established public compatibility name
  MAX_REVIEW_PAYLOAD_BYTES as MAX_PAYLOAD_BYTES,
  // oxlint-disable-next-line no-mistakes/ts-no-export-renaming -- preserve the package's established public compatibility name
  ReviewPayloadError as PostReviewError,
  type ReviewComment,
  type SanitizedReview,
} from '../gha-review-payload/index.mts'

export type PullFile = ReviewFile

export type PostResult = {
  ok: boolean
  status: number
  body: string
}

export type PostReviewIo = {
  readFile(path: string): Buffer
  removeFile(path: string): void
  getHeadSha(): string
  listPullFiles(): PullFile[]
  postReview(payload: SanitizedReview): PostResult
}

export type PostReviewResult = {
  posted: boolean
  commentCount: number
}

/**
 * Posts a validated review, optionally prefixing the body with a provider attribution line.
 * The attribution is cosmetic (final posted text only); it never affects staged payload bytes.
 */
export function runPostReview(
  payloadPath: string,
  io: PostReviewIo,
  providerName?: string,
): PostReviewResult {
  try {
    const selectedHeadSha = io.getHeadSha()
    let review = parseReviewPayload(io.readFile(payloadPath), selectedHeadSha)
    try {
      review = remapReviewComments(review, indexReviewFiles(io.listPullFiles()))
    } catch {
      // Keep the parsed review when the PR file list is unavailable.
    }
    // The adapter also revalidates a pinned base; equality catches legacy live-head drift.
    if (io.getHeadSha() !== selectedHeadSha) {
      throw new ReviewPayloadError('PR head changed while preparing the selected review.')
    }
    const commentCount = review.comments.length
    const attributedReview = providerName
      ? { ...review, body: `**${providerName} review**\n\n${review.body}` }
      : review
    const first = io.postReview(attributedReview)
    if (first.ok) return { posted: true, commentCount }
    throw new ReviewPayloadError(`GitHub review POST failed (HTTP ${first.status}).`)
  } finally {
    io.removeFile(payloadPath)
  }
}
