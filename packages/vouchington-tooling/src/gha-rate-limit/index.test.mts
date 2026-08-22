import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GitHubRateLimitError,
  isRateLimited,
  isRetryableCancellationError,
  MAX_RATE_LIMIT_WAIT_MS,
  rateLimitDelay,
  reserveRateLimitDelay,
} from './index.mts'

function httpError(
  status: number,
  headers: { remaining?: string; reset?: string; retryAfter?: string } = {},
) {
  return new GitHubRateLimitError(
    'HTTP_STATUS',
    `HTTP ${status}`,
    status,
    headers.retryAfter,
    headers.remaining,
    headers.reset,
  )
}

describe('GitHub rate-limit policy', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records constructor fields on GitHubRateLimitError', () => {
    const error = httpError(429, { retryAfter: '2', remaining: '0', reset: '1' })
    expect(error).toMatchObject({
      name: 'GitHubRateLimitError',
      code: 'HTTP_STATUS',
      httpStatus: 429,
      retryAfter: '2',
      rateLimitRemaining: '0',
      rateLimitReset: '1',
    })
  })

  it('uses retry-after seconds when the header is a bounded integer', () => {
    expect(rateLimitDelay(httpError(429, { retryAfter: '2' }))).toBe(2_000)
    expect(rateLimitDelay(httpError(403, { retryAfter: '0' }))).toBe(0)
  })

  it('rejects invalid or unbounded retry-after values', () => {
    for (const retryAfter of ['1.5', '-1', '61', '9007199254740991']) {
      expect(() => rateLimitDelay(httpError(429, { retryAfter }))).toThrow(
        expect.objectContaining({ code: 'INVALID_RESPONSE', name: 'GitHubRateLimitError' }),
      )
    }
  })

  it('uses the bounded fallback for a headerless 429', () => {
    expect(rateLimitDelay(httpError(429))).toBe(60_000)
    expect(rateLimitDelay(httpError(429, { remaining: '3' }))).toBe(60_000)
  })

  it('rejects non-digit remaining counts and non-429 fallbacks', () => {
    expect(() => rateLimitDelay(httpError(429, { remaining: 'x' }))).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    )
    expect(() => rateLimitDelay(httpError(403, { remaining: '1' }))).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    )
  })

  it.each([
    [httpError(403, { retryAfter: '1' }), true],
    [httpError(403, { remaining: '0', reset: '1' }), true],
    [httpError(403), false],
  ])('recognizes only explicitly rate-limited 403 responses', (error, expected) => {
    expect(isRateLimited(error)).toBe(expected)
    expect(isRetryableCancellationError(error)).toBe(expected)
  })

  it('clamps an elapsed primary reset to zero', () => {
    expect(rateLimitDelay(httpError(429, { remaining: '0', reset: '1' }))).toBe(0)
  })

  it('waits until a future primary reset within the delay bound', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const reset = Math.floor(Date.now() / 1000) + 10
    expect(rateLimitDelay(httpError(429, { remaining: '0', reset: String(reset) }))).toBe(10_000)
  })

  it('rejects missing, non-digit, unsafe, and too-distant reset timestamps', () => {
    expect(() => rateLimitDelay(httpError(429, { remaining: '0' }))).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    )
    expect(() => rateLimitDelay(httpError(429, { remaining: '0', reset: 'soon' }))).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    )
    expect(() =>
      rateLimitDelay(httpError(429, { remaining: '0', reset: '9007199254740993' })),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }))

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const reset = Math.floor(Date.now() / 1000) + 61
    expect(() => rateLimitDelay(httpError(429, { remaining: '0', reset: String(reset) }))).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    )
  })

  it('bounds cumulative waits across the drain', () => {
    const used = { milliseconds: 0 }
    reserveRateLimitDelay(used, 60_000)
    reserveRateLimitDelay(used, 60_000)
    expect(used.milliseconds).toBe(MAX_RATE_LIMIT_WAIT_MS)
    expect(() => reserveRateLimitDelay(used, 1)).toThrow(
      expect.objectContaining({
        code: 'RATE_LIMIT_WAIT_EXHAUSTED',
        name: 'GitHubRateLimitError',
      }),
    )
    reserveRateLimitDelay(used, 0)
    expect(used.milliseconds).toBe(MAX_RATE_LIMIT_WAIT_MS)
  })

  it('keeps 5xx retryable without classifying it as rate limited', () => {
    const error = httpError(500)
    expect(isRetryableCancellationError(error)).toBe(true)
    expect(isRetryableCancellationError(httpError(599))).toBe(true)
    expect(isRetryableCancellationError(httpError(499))).toBe(false)
    expect(isRetryableCancellationError(httpError(600))).toBe(false)
    expect(isRateLimited(error)).toBe(false)
  })

  it('retries request failures and ignores unrelated values', () => {
    const failed = new GitHubRateLimitError('REQUEST_FAILED', 'GitHub request failed')
    expect(isRetryableCancellationError(failed)).toBe(true)
    expect(isRateLimited(failed)).toBe(false)
    expect(isRetryableCancellationError(new GitHubRateLimitError('OTHER', 'nope'))).toBe(false)
    expect(isRetryableCancellationError('not-an-error')).toBe(false)
    expect(isRateLimited('not-an-error')).toBe(false)
    expect(
      isRetryableCancellationError(new GitHubRateLimitError('HTTP_STATUS', 'missing status')),
    ).toBe(false)
  })
})
