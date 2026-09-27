// toErrorDetail() feeds sanitizeInlineErrorMessage() (a .replace() call) and errorStack.slice()
// downstream — both would throw a TypeError on a non-string input. This function runs inside
// process.on('uncaughtException')/('unhandledRejection'), the sentinel's last line of defense
// (vitest-fork-exit-sentinel.mts): if it throws, that handler crashes too, losing the sentinel line
// entirely instead of degrading gracefully. TypeScript's Error.message/stack types are compile-time
// only — a subclass overriding either with a non-string value violates them at runtime.
import { describe, expect, it } from 'vitest'
import { toErrorDetail } from './vitest-fork-exit-error-detail.mts'

describe('toErrorDetail', () => {
  it('extracts message and stack from a normal Error', () => {
    const error = new Error('boom')
    const detail = toErrorDetail(error)

    // oxlint-disable-next-line no-mistakes/test-no-error-message-matching -- message is toErrorDetail's literal data-contract output, not a fragile human-readable error string
    expect(detail.message).toBe('boom')
    expect(detail.stack).toBe(error.stack)
  })

  it('coerces a non-string message to a string instead of passing it through raw', () => {
    const error = new Error('boom')
    Object.defineProperty(error, 'message', { value: { code: 42 } })

    expect(() => toErrorDetail(error)).not.toThrow()
    // oxlint-disable-next-line no-mistakes/test-no-error-message-matching -- message is toErrorDetail's literal data-contract output, not a fragile human-readable error string
    expect(toErrorDetail(error).message).toBe('[object Object]')
  })

  it('falls back to undefined for a non-string stack instead of passing it through raw', () => {
    const error = new Error('boom')
    Object.defineProperty(error, 'stack', { value: 12345 })

    expect(() => toErrorDetail(error)).not.toThrow()
    expect(toErrorDetail(error).stack).toBeUndefined()
  })

  it('stringifies a non-Error value', () => {
    expect(toErrorDetail('plain string reject reason')).toStrictEqual({
      message: 'plain string reject reason',
      stack: undefined,
    })
    expect(toErrorDetail(undefined)).toStrictEqual({ message: 'undefined', stack: undefined })
  })
})
