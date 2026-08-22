import { describe, expect, it } from 'vitest'

import {
  MAX_REVIEW_COMMENTS,
  MAX_REVIEW_PAYLOAD_BYTES,
  ReviewPayloadError,
  bodyOnlyReviewFallback,
  parseReviewPayload,
} from './payload.mts'

const COMMIT_ID = '0123456789abcdef0123456789abcdef01234567'

function comment(index: number, overrides: Record<string, unknown> = {}) {
  return {
    path: `src/${index}.mts`,
    line: index,
    side: 'RIGHT',
    body: `Finding ${index}`,
    ...overrides,
  }
}

describe('parseReviewPayload', () => {
  it('rejects empty, oversized, malformed, and non-object JSON', () => {
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.alloc(MAX_REVIEW_PAYLOAD_BYTES + 1),
      Buffer.from('{'),
      Buffer.from('[]'),
    ]) {
      expect(() => parseReviewPayload(bytes, COMMIT_ID)).toThrow(ReviewPayloadError)
    }
  })

  it('sanitizes the exact review shape and forces the supplied commit id', () => {
    const parsed = parseReviewPayload(
      Buffer.from(
        JSON.stringify({
          event: 'APPROVE',
          commit_id: 'attacker-controlled',
          extra: 'dropped',
          body: 'Verdict.',
          comments: [
            comment(1, { extra: 'dropped', start_line: 1, start_side: 'RIGHT' }),
            comment(2, { path: 'bad\u0000path' }),
            comment(3, { line: 0 }),
            comment(4, { start_line: 5, start_side: 'RIGHT' }),
          ],
        }),
      ),
      COMMIT_ID,
    )
    expect(parsed).toEqual({
      event: 'COMMENT',
      commit_id: COMMIT_ID,
      body: 'Verdict.',
      comments: [
        {
          path: 'src/1.mts',
          line: 1,
          side: 'RIGHT',
          body: 'Finding 1',
          start_line: 1,
          start_side: 'RIGHT',
        },
      ],
    })
  })

  it('drops every malformed comment shape and defaults non-array comments', () => {
    const malformed = [
      null,
      'comment',
      [],
      {},
      { path: '', line: 1, side: 'RIGHT', body: 'x' },
      { path: 'x', line: 1.5, side: 'RIGHT', body: 'x' },
      { path: 'x', line: -1, side: 'RIGHT', body: 'x' },
      { path: 'x', line: 1, side: 'MIDDLE', body: 'x' },
      { path: 'x', line: 1, side: 'RIGHT', body: '' },
      { path: 'x', line: 1, side: 'RIGHT', body: 'x', start_line: 0, start_side: 'RIGHT' },
      { path: 'x', line: 1, side: 'RIGHT', body: 'x', start_line: 2, start_side: 'RIGHT' },
      { path: 'x', line: 1, side: 'RIGHT', body: 'x', start_line: 1, start_side: 'MIDDLE' },
    ]
    expect(
      parseReviewPayload(
        Buffer.from(JSON.stringify({ body: 'fallback', comments: malformed })),
        COMMIT_ID,
      ),
    ).toEqual({ event: 'COMMENT', commit_id: COMMIT_ID, body: 'fallback', comments: [] })
    expect(
      parseReviewPayload(
        Buffer.from(JSON.stringify({ body: 'no comments', comments: 'wrong' })),
        COMMIT_ID,
      ),
    ).toEqual({ event: 'COMMENT', commit_id: COMMIT_ID, body: 'no comments', comments: [] })
  })

  it('keeps the first comment cap and records valid overflow in the body', () => {
    const parsed = parseReviewPayload(
      Buffer.from(
        JSON.stringify({
          comments: Array.from({ length: MAX_REVIEW_COMMENTS + 1 }, (_, i) => comment(i + 1)),
        }),
      ),
      COMMIT_ID,
    )
    expect(parsed.comments).toHaveLength(MAX_REVIEW_COMMENTS)
    expect(parsed.body).toContain(`## Comments over the ${MAX_REVIEW_COMMENTS}-comment cap`)
    expect(parsed.body).toContain(`src/${MAX_REVIEW_COMMENTS + 1}.mts:${MAX_REVIEW_COMMENTS + 1}`)
  })

  it('rejects a payload with neither a body nor valid comments', () => {
    expect(() =>
      parseReviewPayload(Buffer.from(JSON.stringify({ body: '', comments: [{}] })), COMMIT_ID),
    ).toThrow('no review body and no valid comments')
  })

  it('uses the inline-only body when comments are valid but the body is absent', () => {
    expect(
      parseReviewPayload(Buffer.from(JSON.stringify({ comments: [comment(1)] })), COMMIT_ID),
    ).toMatchObject({ body: 'Inline findings only.', comments: [comment(1)] })
  })
})

describe('bodyOnlyReviewFallback', () => {
  it('preserves findings as body text and strips all inline comments', () => {
    const review = parseReviewPayload(
      Buffer.from(JSON.stringify({ body: 'Verdict.', comments: [comment(1)] })),
      COMMIT_ID,
    )
    expect(bodyOnlyReviewFallback(review, 422)).toEqual({
      event: 'COMMENT',
      commit_id: COMMIT_ID,
      body: expect.stringContaining('HTTP 422'),
      comments: [],
    })
  })

  it('requires the trusted commit identity to be a full lowercase SHA', () => {
    for (const commitId of [
      '',
      'abc123',
      '0123456789abcdef0123456789abcdef0123456G',
      '0123456789ABCDEF0123456789abcdef01234567',
      '0123456789abcdef0123456789abcdef012345678',
    ]) {
      expect(() => parseReviewPayload(Buffer.from('{"body":"ok"}'), commitId)).toThrow(
        '40-character lowercase hexadecimal',
      )
    }
  })

  it('uses a status-only fallback when there is no original body or comments', () => {
    expect(
      bodyOnlyReviewFallback(
        { event: 'COMMENT', commit_id: COMMIT_ID, body: '', comments: [] },
        422,
      ),
    ).toEqual({
      event: 'COMMENT',
      commit_id: COMMIT_ID,
      body: 'Inline findings not posted (HTTP 422).',
      comments: [],
    })
  })
})
