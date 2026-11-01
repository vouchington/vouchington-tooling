import { describe, expect, it } from 'vitest'

import * as api from './index.mts'

describe('final-review index', () => {
  it('exports the public surface', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DEFAULT_LIMITS',
      'EFFORTS',
      'FINAL_APPROVAL_LABEL',
      'FinalReviewError',
      'NUMBERED_DIFF_LEGEND',
      'PILLARS',
      'SEVERITIES',
      'assertPullTarget',
      'buildFinalReviews',
      'createGhFinalReviewIo',
      'deriveVerdict',
      'finalReviewStatus',
      'numberDiff',
      'packBodies',
      'parseFinalReviewInput',
      'placeFindings',
      'postFinalReview',
      'renderBodyFinding',
      'renderFindingBody',
      'renderHeader',
      'reviewMarker',
      'revokeFinalApproval',
    ])
  })
})
