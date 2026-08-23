import { describe, expect, it } from 'vitest'

import { PostReviewError } from './post.mts'
import { requireEnv, resolveReviewPostToken } from './token.mts'

describe('resolveReviewPostToken', () => {
  it('defaults to the Claude App mint path', () => {
    expect(resolveReviewPostToken({})).toEqual({ source: 'claude-app' })
    expect(resolveReviewPostToken({ CODE_REVIEW_TOKEN_SOURCE: 'claude-app' })).toEqual({
      source: 'claude-app',
    })
  })

  it('uses GH_TOKEN for github-token and fails closed when missing', () => {
    expect(
      resolveReviewPostToken({
        CODE_REVIEW_TOKEN_SOURCE: 'github-token',
        GH_TOKEN: 'job-token',
      }),
    ).toEqual({ source: 'github-token', token: 'job-token' })
    expect(
      resolveReviewPostToken({
        CODE_REVIEW_TOKEN_SOURCE: 'github-token',
        GITHUB_TOKEN: 'fallback-token',
      }),
    ).toEqual({ source: 'github-token', token: 'fallback-token' })
    expect(() => resolveReviewPostToken({ CODE_REVIEW_TOKEN_SOURCE: 'github-token' })).toThrow(
      PostReviewError,
    )
    expect(() => resolveReviewPostToken({ CODE_REVIEW_TOKEN_SOURCE: 'github-token' })).toThrow(
      'GH_TOKEN or GITHUB_TOKEN is required.',
    )
  })

  it('rejects an unknown token source', () => {
    expect(() => resolveReviewPostToken({ CODE_REVIEW_TOKEN_SOURCE: 'mystery' })).toThrow(
      'Unknown CODE_REVIEW_TOKEN_SOURCE "mystery".',
    )
  })
})

describe('requireEnv', () => {
  it('returns the named value and fails closed when missing', () => {
    expect(requireEnv('PR_NUMBER', { PR_NUMBER: '12' })).toBe('12')
    expect(() => requireEnv('PR_NUMBER', {})).toThrow('PR_NUMBER is required.')
  })
})
