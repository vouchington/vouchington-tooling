import { describe, expect, it } from 'vitest'

import {
  PostReviewError,
  postReviewWithTokenFromEnv,
  runPostReview,
  runPostReviewCli,
} from './index.mts'

describe('gha-post-review exports', () => {
  it('re-exports posting helpers', () => {
    expect(typeof runPostReview).toBe('function')
    expect(typeof runPostReviewCli).toBe('function')
    expect(typeof postReviewWithTokenFromEnv).toBe('function')
    expect(new PostReviewError('x').name).toBe('ReviewPayloadError')
  })
})
