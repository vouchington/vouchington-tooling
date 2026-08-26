import { describe, expect, it } from 'vitest'

import {
  MAX_REVIEW_COMMENTS,
  MAX_REVIEW_PAYLOAD_BYTES,
  ReviewPayloadError,
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
          comments: [comment(1, { extra: 'dropped', start_line: 1, start_side: 'RIGHT' })],
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

  it('rejects malformed comments and non-array comments', () => {
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
    for (const malformedComment of malformed) {
      expect(() =>
        parseReviewPayload(
          Buffer.from(JSON.stringify({ body: 'summary', comments: [malformedComment] })),
          COMMIT_ID,
        ),
      ).toThrow('Every finding must be a valid inline comment')
    }
    expect(() =>
      parseReviewPayload(
        Buffer.from(JSON.stringify({ body: 'summary', comments: 'wrong' })),
        COMMIT_ID,
      ),
    ).toThrow('comments must be an array')
  })

  it('rejects findings over the inline comment cap', () => {
    expect(() =>
      parseReviewPayload(
        Buffer.from(
          JSON.stringify({
            comments: Array.from({ length: MAX_REVIEW_COMMENTS + 1 }, (_, i) => comment(i + 1)),
          }),
        ),
        COMMIT_ID,
      ),
    ).toThrow(`more than ${MAX_REVIEW_COMMENTS} inline comments`)
  })

  it('rejects a payload with malformed findings and no summary', () => {
    expect(() =>
      parseReviewPayload(Buffer.from(JSON.stringify({ body: '', comments: [{}] })), COMMIT_ID),
    ).toThrow('Every finding must be a valid inline comment')
  })

  it('accepts a body-only no-findings summary', () => {
    expect(
      parseReviewPayload(
        Buffer.from(JSON.stringify({ body: 'No findings.', comments: [] })),
        COMMIT_ID,
      ),
    ).toEqual({
      event: 'COMMENT',
      commit_id: COMMIT_ID,
      body: 'No findings.',
      comments: [],
    })
  })

  it('rejects a payload without a verdict or inline findings', () => {
    expect(() => parseReviewPayload(Buffer.from('{}'), COMMIT_ID)).toThrow(
      'Payload has no review body and no valid comments',
    )
  })

  it('uses the inline-only body when comments are valid but the body is absent', () => {
    expect(
      parseReviewPayload(Buffer.from(JSON.stringify({ comments: [comment(1)] })), COMMIT_ID),
    ).toMatchObject({ body: 'Inline findings only.', comments: [comment(1)] })
  })
})
describe('trusted commit identity', () => {
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
})
