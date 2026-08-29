import {
  ReviewPayloadError,
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
    const selectedHeadSha = io.getHeadSha()
    let review = parseReviewPayload(io.readFile(payloadPath), selectedHeadSha)
    try {
      review = remapReviewComments(review, indexReviewFiles(io.listPullFiles()))
    } catch {
      // Keep the parsed review when the PR file list is unavailable.
    }
    if (io.getHeadSha() !== selectedHeadSha) {
      throw new ReviewPayloadError('PR head changed while preparing the selected review.')
    }
    const first = io.postReview(review)
    if (first.ok) return { posted: true }
    throw new ReviewPayloadError(`GitHub review POST failed (HTTP ${first.status}).`)
  } finally {
    io.removeFile(payloadPath)
  }
}
