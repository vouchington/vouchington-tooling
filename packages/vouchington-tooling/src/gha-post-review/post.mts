import {
  ReviewPayloadError,
  bodyOnlyReviewFallback,
  indexReviewFiles,
  parseReviewPayload,
  remapReviewComments,
  type ReviewFile,
  type SanitizedReview,
} from '../gha-review-payload/index.mts'

export {
  MAX_REVIEW_COMMENTS as MAX_COMMENTS,
  MAX_REVIEW_PAYLOAD_BYTES as MAX_PAYLOAD_BYTES,
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

export function runPostReview(payloadPath: string, io: PostReviewIo): { posted: boolean } {
  try {
    let review = parseReviewPayload(io.readFile(payloadPath), io.getHeadSha())
    try {
      review = remapReviewComments(review, indexReviewFiles(io.listPullFiles()))
    } catch {
      // Keep the parsed review when the PR file list is unavailable.
    }
    const first = io.postReview(review)
    if (first.ok) return { posted: true }
    if (first.status !== 422) {
      throw new ReviewPayloadError(`GitHub review POST failed (HTTP ${first.status}).`)
    }
    const retry = io.postReview(bodyOnlyReviewFallback(review, first.status))
    if (!retry.ok) {
      throw new ReviewPayloadError(`GitHub review POST retry failed (HTTP ${retry.status}).`)
    }
    return { posted: true }
  } finally {
    io.removeFile(payloadPath)
  }
}
