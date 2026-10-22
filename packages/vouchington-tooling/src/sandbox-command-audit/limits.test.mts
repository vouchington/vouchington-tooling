import { describe, expect, it } from 'vitest'
import {
  appendBounded,
  DEFAULT_LIMITS,
  emptyRawRetention,
  extractToolResultText,
  resolveLimits,
  truncateRawText,
} from './limits.mts'

describe('resolveLimits', () => {
  it('returns the defaults, and overrides only the named caps', () => {
    expect(resolveLimits()).toEqual(DEFAULT_LIMITS)
    expect(resolveLimits({ maxRetainedRecords: 3 })).toEqual({
      ...DEFAULT_LIMITS,
      maxRetainedRecords: 3,
    })
  })
})

describe('resolveLimits validation', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (value) => {
    expect(() => resolveLimits({ maxRetainedRecords: value })).toThrow(
      'limits.maxRetainedRecords must be a non-negative integer',
    )
  })

  it('accepts zero', () => {
    expect(resolveLimits({ maxRetainedRecords: 0 })).toEqual({
      ...DEFAULT_LIMITS,
      maxRetainedRecords: 0,
    })
  })
})

describe('truncateRawText', () => {
  const limits = resolveLimits({ maxRetainedRawTextChars: 4 })

  it('keeps short text untouched', () => {
    const retention = emptyRawRetention()
    expect(truncateRawText('abcd', retention, 'command', limits)).toBe('abcd')
    expect(retention).toEqual(emptyRawRetention())
  })

  it('truncates and counts commands and errors separately', () => {
    const retention = emptyRawRetention()
    expect(truncateRawText('abcdef', retention, 'command', limits)).toBe('abcd… [truncated]')
    truncateRawText('abcdef', retention, 'error', limits)
    truncateRawText('abcdef', retention, 'error', limits)
    expect(retention.commandTextsTruncated).toBe(1)
    expect(retention.errorTextsTruncated).toBe(2)
  })
})

describe('appendBounded', () => {
  it('stops at the record cap and counts what it dropped', () => {
    const retention = emptyRawRetention()
    const records: string[] = []
    const limits = resolveLimits({ maxRetainedRecords: 1 })
    appendBounded(records, 'a', retention, limits)
    appendBounded(records, 'b', retention, limits)
    expect(records).toEqual(['a'])
    expect(retention).toMatchObject({ recordsDropped: 1, rawBytesDropped: 3, retainedRawBytes: 3 })
  })

  it('stops at the byte cap', () => {
    const retention = emptyRawRetention()
    const records: string[] = []
    const limits = resolveLimits({ maxRetainedRawBytes: 4 })
    appendBounded(records, 'a', retention, limits)
    appendBounded(records, 'b', retention, limits)
    expect(records).toEqual(['a'])
    expect(retention.recordsDropped).toBe(1)
  })
})

describe('extractToolResultText', () => {
  it('reads a string, joins text blocks, and ignores everything else', () => {
    expect(extractToolResultText('plain')).toBe('plain')
    expect(extractToolResultText(undefined)).toBe('')
    expect(
      extractToolResultText([
        { type: 'text', text: 'one' },
        { type: 'image' },
        { type: 'text', text: 'two' },
        'bare',
      ]),
    ).toBe('one\n\ntwo\n')
  })
})
