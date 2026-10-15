import { describe, expect, it } from 'vitest'

import {
  countDiffLineChanges,
  DEFAULT_LARGE_DIFF_THRESHOLDS,
  exceedsLargeDiffThreshold,
} from './index.mts'

describe('countDiffLineChanges', () => {
  it('returns 0 for an empty diff', () => {
    expect(countDiffLineChanges('')).toEqual({ added: 0, deleted: 0 })
  })

  it('counts both added and removed lines', () => {
    const diff = [
      'diff --git a/x.txt b/x.txt',
      '+++ b/x.txt',
      '--- a/x.txt',
      '+added',
      '-removed',
    ].join('\n')
    expect(countDiffLineChanges(diff)).toEqual({ added: 1, deleted: 1 })
  })

  it('excludes the +++/--- file-header lines', () => {
    const diff = ['--- a/x.txt', '+++ b/x.txt', '+one', '+two'].join('\n')
    expect(countDiffLineChanges(diff)).toEqual({ added: 2, deleted: 0 })
  })

  it('counts a diff with only additions', () => {
    const diff = ['+++ b/x.txt', '+one', '+two', '+three'].join('\n')
    expect(countDiffLineChanges(diff)).toEqual({ added: 3, deleted: 0 })
  })

  it('counts a diff with only deletions', () => {
    const diff = ['--- a/x.txt', '-one', '-two'].join('\n')
    expect(countDiffLineChanges(diff)).toEqual({ added: 0, deleted: 2 })
  })

  it('excludes any line starting with the literal +++/--- prefix, even real content', () => {
    const diff = ['+++ b/x.txt', '--- a/x.txt', '+++not a header, just content'].join('\n')
    expect(countDiffLineChanges(diff)).toEqual({ added: 0, deleted: 0 })
  })

  it('ignores context lines and diff metadata', () => {
    const diff = [
      'diff --git a/x.txt b/x.txt',
      'index abc123..def456 100644',
      '@@ -1,3 +1,3 @@',
      ' unchanged context line',
      '+added',
      '-removed',
    ].join('\n')
    expect(countDiffLineChanges(diff)).toEqual({ added: 1, deleted: 1 })
  })

  it('counts CRLF diffs the same way', () => {
    expect(countDiffLineChanges('+a\r\n-b\r\n c\r\n')).toEqual({ added: 1, deleted: 1 })
  })
})

describe('exceedsLargeDiffThreshold', () => {
  it('exposes the example defaults', () => {
    expect(DEFAULT_LARGE_DIFF_THRESHOLDS).toEqual({ addedLines: 5000, deletedLines: 20_000 })
  })

  it('uses the default addition limit as a strict bound', () => {
    const { addedLines } = DEFAULT_LARGE_DIFF_THRESHOLDS
    expect(exceedsLargeDiffThreshold({ added: addedLines, deleted: 0 })).toBe(false)
    expect(exceedsLargeDiffThreshold({ added: addedLines + 1, deleted: 0 })).toBe(true)
  })

  it('uses the default deletion limit as a strict bound', () => {
    const { deletedLines } = DEFAULT_LARGE_DIFF_THRESHOLDS
    expect(exceedsLargeDiffThreshold({ added: 0, deleted: deletedLines })).toBe(false)
    expect(exceedsLargeDiffThreshold({ added: 0, deleted: deletedLines + 1 })).toBe(true)
  })

  it('honours caller-supplied thresholds', () => {
    const thresholds = { addedLines: 10, deletedLines: 3 }
    expect(exceedsLargeDiffThreshold({ added: 10, deleted: 3 }, thresholds)).toBe(false)
    expect(exceedsLargeDiffThreshold({ added: 11, deleted: 0 }, thresholds)).toBe(true)
    expect(exceedsLargeDiffThreshold({ added: 0, deleted: 4 }, thresholds)).toBe(true)
  })
})
