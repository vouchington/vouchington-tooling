import { describe, expect, it } from 'vitest'

import { FinalReviewError, parseFinalReviewInput } from './finding.mts'

const base = { pillar: 'rules', severity: 'high', title: ' T ', body: ' B ' }

function finding(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...base, ...extra }
}

function parseOne(extra: Record<string, unknown>) {
  return parseFinalReviewInput({ findings: [finding(extra)] }).findings[0]
}

function failure(raw: unknown): string {
  try {
    parseFinalReviewInput(raw)
  } catch (error) {
    expect(error).toBeInstanceOf(FinalReviewError)
    expect((error as Error).name).toBe('FinalReviewError')
    return (error as Error).message
  }
  throw new Error('expected a failure')
}

describe('parseFinalReviewInput', () => {
  it('applies defaults for an empty object', () => {
    expect(parseFinalReviewInput({})).toEqual({
      effort: 'high',
      summary: '',
      skipped: [],
      findings: [],
    })
  })

  it('parses effort, summary, skipped pillars, and trimmed findings', () => {
    expect(
      parseFinalReviewInput({
        effort: 'low',
        summary: '  hi  ',
        skipped: [{ pillar: 'history', reason: 'no history' }],
        findings: [finding()],
      }),
    ).toEqual({
      effort: 'low',
      summary: 'hi',
      skipped: [{ pillar: 'history', reason: 'no history' }],
      findings: [{ pillar: 'rules', severity: 'high', title: 'T', body: 'B' }],
    })
  })

  it('ignores a non-string summary', () => {
    expect(parseFinalReviewInput({ summary: 4 }).summary).toBe('')
  })

  it('rejects non-objects and bad lists', () => {
    expect(failure(null)).toBe('Input must be a JSON object.')
    expect(failure([])).toBe('Input must be a JSON object.')
    expect(failure('x')).toBe('Input must be a JSON object.')
    expect(failure({ findings: 'x' })).toBe('findings must be an array.')
    expect(failure({ skipped: {} })).toBe('skipped must be an array.')
    expect(failure({ effort: 'max' })).toBe('effort must be one of low, medium, high.')
  })

  it('rejects malformed findings and skipped entries', () => {
    expect(failure({ findings: [1] })).toBe('findings[0] must be an object.')
    expect(failure({ skipped: [null] })).toBe('skipped[0] must be an object.')
    expect(failure({ skipped: [{ pillar: 'nope', reason: 'x' }] })).toContain('skipped[0].pillar')
    expect(failure({ skipped: [{ pillar: 'rules', reason: ' ' }] })).toBe(
      'skipped[0].reason must be a non-empty string.',
    )
    expect(failure({ findings: [finding({ pillar: 'x' })] })).toContain('findings[0].pillar')
    expect(failure({ findings: [finding({ severity: 'x' })] })).toContain('findings[0].severity')
    expect(failure({ findings: [finding({ title: '' })] })).toBe(
      'findings[0].title must be a non-empty string.',
    )
    expect(failure({ findings: [finding({ body: 3 })] })).toBe(
      'findings[0].body must be a non-empty string.',
    )
  })
})

describe('finding locations', () => {
  it('accepts findings without a location', () => {
    expect(parseOne({})).not.toHaveProperty('path')
  })

  it('accepts a path only, and a path with a line defaulting to RIGHT', () => {
    expect(parseOne({ path: 'a.ts' })).toMatchObject({ path: 'a.ts' })
    expect(parseOne({ path: 'a.ts' })).not.toHaveProperty('line')
    expect(parseOne({ path: 'a.ts', line: 3 })).toMatchObject({
      path: 'a.ts',
      line: 3,
      side: 'RIGHT',
    })
    expect(parseOne({ path: 'a.ts', line: 3, side: 'LEFT' })).toMatchObject({ side: 'LEFT' })
    expect(parseOne({ path: 'a.ts', line: 3, startLine: 1 })).toMatchObject({ startLine: 1 })
  })

  it('rejects invalid locations', () => {
    const message = (extra: Record<string, unknown>) => failure({ findings: [finding(extra)] })
    expect(message({ line: 3 })).toBe('findings[0].line needs a path.')
    expect(message({ path: 'a\0b' })).toBe('findings[0].path is invalid.')
    expect(message({ path: '' })).toContain('findings[0].path')
    expect(message({ path: 'a', line: 0 })).toBe('findings[0].line must be a positive integer.')
    expect(message({ path: 'a', line: 1.5 })).toBe('findings[0].line must be a positive integer.')
    expect(message({ path: 'a', line: '1' })).toBe('findings[0].line must be a positive integer.')
    expect(message({ path: 'a', line: 2, side: 'MID' })).toContain('findings[0].side')
    expect(message({ path: 'a', line: 2, startLine: 2 })).toBe(
      'findings[0].startLine must be below line.',
    )
    expect(message({ path: 'a', line: 2, startLine: 0 })).toBe(
      'findings[0].startLine must be a positive integer.',
    )
  })
})
