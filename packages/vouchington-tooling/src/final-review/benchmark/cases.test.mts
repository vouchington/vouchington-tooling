import { describe, expect, it } from 'vitest'

import { FinalReviewError } from '../finding.mts'
import { casesForPillar, parseEvalCases } from './cases.mts'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

function positive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    repo: 'acme/widgets',
    pr: 3,
    title: 'Title',
    baseSha: SHA_A,
    headSha: SHA_B,
    kind: 'positive',
    reason: 'why',
    expected: [{ pillar: 'security', severity: 'high', path: 'a.ts', lines: [3, 5], claim: 'bad' }],
    ...overrides,
  }
}

function negative(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return positive({ id: 'n1', kind: 'negative', expected: [], ...overrides })
}

function message(raw: unknown): string {
  try {
    parseEvalCases(raw)
  } catch (error) {
    expect(error).toBeInstanceOf(FinalReviewError)
    return (error as Error).message
  }
  throw new Error('expected a failure')
}

describe('parseEvalCases', () => {
  it('parses positive and negative cases', () => {
    const [first, second] = parseEvalCases([positive(), negative({ reason: undefined })])
    expect(first).toEqual({
      id: 'p1',
      repo: 'acme/widgets',
      pr: 3,
      title: 'Title',
      baseSha: SHA_A,
      headSha: SHA_B,
      kind: 'positive',
      reason: 'why',
      expected: [
        { pillar: 'security', severity: 'high', path: 'a.ts', lines: [3, 5], claim: 'bad' },
      ],
    })
    expect(second).toMatchObject({ id: 'n1', reason: '', expected: [] })
  })

  it('normalizes empty paths and missing lines to null', () => {
    const [item] = parseEvalCases([
      positive({
        expected: [
          { pillar: 'rules', severity: 'low', path: '', claim: 'c' },
          { pillar: 'rules', severity: 'low', path: 7, lines: null, claim: 'c' },
        ],
      }),
    ])
    expect(item?.expected.map((entry) => [entry.path, entry.lines])).toEqual([
      [null, null],
      [null, null],
    ])
  })

  it('rejects non-array input and duplicate ids', () => {
    expect(message({})).toBe('Eval cases must be a JSON array.')
    expect(message([positive(), positive()])).toBe('Duplicate eval case id: p1')
  })

  it('rejects malformed cases', () => {
    expect(message([1])).toBe('cases[0]: must be an object')
    expect(message([positive({ id: 4 })])).toBe('cases[0]: id must be a string')
    expect(message([positive({ repo: 'bad' })])).toBe('cases[0]: repo must be owner/name')
    expect(message([positive({ baseSha: 'abc' })])).toBe(
      'cases[0]: baseSha and headSha must be full SHAs',
    )
    expect(message([positive({ headSha: 'abc' })])).toBe(
      'cases[0]: baseSha and headSha must be full SHAs',
    )
    expect(message([positive({ kind: 'other' })])).toBe(
      'cases[0]: kind must be positive or negative',
    )
    expect(message([positive({ pr: 0 })])).toBe('cases[0]: pr must be a positive integer')
    expect(message([positive({ pr: 'x' })])).toBe('cases[0]: pr must be a positive integer')
    expect(message([positive({ expected: 'x' })])).toBe('cases[0]: expected must be an array')
    expect(message([positive({ expected: [] })])).toBe(
      'cases[0]: a positive case needs an expected finding',
    )
    expect(message([negative({ expected: [positive().expected] })])).toContain(
      'cases[0].expected[0]: must be an object',
    )
  })

  it('rejects a negative case with expectations', () => {
    const entry = { pillar: 'rules', severity: 'low', claim: 'c' }
    expect(message([negative({ expected: [entry] })])).toBe(
      'cases[0]: a negative case has no expected findings',
    )
  })

  it('rejects malformed expectations', () => {
    const entry = (extra: Record<string, unknown>) =>
      message([
        positive({ expected: [{ pillar: 'rules', severity: 'low', claim: 'c', ...extra }] }),
      ])
    expect(entry({ pillar: 'x' })).toBe('cases[0].expected[0]: unknown pillar')
    expect(entry({ severity: 'x' })).toBe('cases[0].expected[0]: unknown severity')
    expect(entry({ claim: 3 })).toBe('cases[0].expected[0]: claim must be a string')
    expect(entry({ lines: [1] })).toBe('cases[0].expected[0]: lines must be [start, end] or null')
    expect(entry({ lines: 'x' })).toBe('cases[0].expected[0]: lines must be [start, end] or null')
    for (const lines of [
      [0, 2],
      [3, 2],
      [1.5, 2],
      [1, 2.5],
      ['1', 2],
    ]) {
      expect(entry({ lines })).toBe(
        'cases[0].expected[0]: lines must be ascending positive integers',
      )
    }
  })
})

describe('casesForPillar', () => {
  it('keeps positives for the pillar and every negative', () => {
    const cases = parseEvalCases([
      positive(),
      positive({
        id: 'p2',
        expected: [{ pillar: 'rules', severity: 'low', claim: 'c' }],
      }),
      negative(),
    ])
    expect(casesForPillar(cases, 'security').map((item) => item.id)).toEqual(['p1', 'n1'])
    expect(casesForPillar(cases, 'design').map((item) => item.id)).toEqual(['n1'])
  })
})
