import { describe, expect, it } from 'vitest'

import { boundPendingLine, DEFAULT_TRUNCATED_LINE_MARKER, splitCompleteLines } from './index.mts'

describe('boundPendingLine', () => {
  it('returns short values unchanged', () => {
    expect(boundPendingLine('hello')).toBe('hello')
    expect(boundPendingLine('abcd', '<>', 4)).toBe('abcd')
  })

  it('inserts the truncation marker in the middle of an oversized line', () => {
    expect(boundPendingLine('abcdefghij', '<>', 6)).toBe('ab<>ij')
    expect(boundPendingLine('a'.repeat(50), DEFAULT_TRUNCATED_LINE_MARKER, 40)).toContain(
      DEFAULT_TRUNCATED_LINE_MARKER,
    )
  })

  it('keeps only the marker when it is longer than the max length', () => {
    expect(boundPendingLine('abcdefghij', 'MARKER', 4)).toBe('MARKER')
  })
})

describe('splitCompleteLines', () => {
  it('splits LF and CRLF lines and keeps a trailing CR pending', () => {
    expect(splitCompleteLines('a\nb\n')).toEqual({ complete: ['a\n', 'b\n'], pending: '' })
    expect(splitCompleteLines('a\r\nb')).toEqual({ complete: ['a\r\n'], pending: 'b' })
    expect(splitCompleteLines('partial\r')).toEqual({ complete: [], pending: 'partial\r' })
    expect(splitCompleteLines('a\rb\n')).toEqual({ complete: ['a\r', 'b\n'], pending: '' })
  })

  it('returns the whole value as pending when there is no line break', () => {
    expect(splitCompleteLines('no-break')).toEqual({ complete: [], pending: 'no-break' })
  })
})
