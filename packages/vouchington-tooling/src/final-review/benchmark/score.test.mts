import { describe, expect, it } from 'vitest'

import type { Finding } from '../finding.mts'
import type { EvalCase, ExpectedFinding } from './cases.mts'
import {
  matches,
  renderSummaryTable,
  scoreCase,
  summarizePillar,
  type CaseScore,
} from './score.mts'

function exp(overrides: Partial<ExpectedFinding> = {}): ExpectedFinding {
  return {
    pillar: 'security',
    severity: 'high',
    path: 'src/a.ts',
    lines: [20, 30],
    claim: 'c',
    ...overrides,
  }
}

function found(overrides: Partial<Finding> = {}): Finding {
  return {
    pillar: 'security',
    severity: 'high',
    title: 't',
    body: 'b',
    path: 'src/a.ts',
    line: 25,
    ...overrides,
  }
}

function item(kind: EvalCase['kind'], expected: ExpectedFinding[]): EvalCase {
  return {
    id: 'c',
    repo: 'a/b',
    pr: 1,
    title: 't',
    baseSha: 'x',
    headSha: 'y',
    kind,
    reason: '',
    expected,
  }
}

function without(key: 'path' | 'line'): Finding {
  const { [key]: _omitted, ...rest } = found()
  return rest
}

describe('matches', () => {
  it('matches any finding when no path is expected', () => {
    expect(matches(exp({ path: null }), without('path'))).toBe(true)
  })

  it('requires a normalized path to agree', () => {
    expect(matches(exp(), without('path'))).toBe(false)
    expect(matches(exp(), found({ path: 'src/b.ts' }))).toBe(false)
    expect(matches(exp(), found({ path: './src/a.ts' }))).toBe(true)
    expect(matches(exp(), found({ path: '/src/a.ts' }))).toBe(true)
  })

  it('accepts findings with no line or no expected range', () => {
    expect(matches(exp(), without('line'))).toBe(true)
    expect(matches(exp({ lines: null }), found({ line: 999 }))).toBe(true)
  })

  it('applies a line tolerance on both ends', () => {
    expect(matches(exp(), found({ line: 40 }))).toBe(true)
    expect(matches(exp(), found({ line: 41 }))).toBe(false)
    expect(matches(exp(), found({ line: 10 }))).toBe(true)
    expect(matches(exp(), found({ line: 9 }))).toBe(false)
    expect(matches(exp(), found({ line: 50, startLine: 35 }))).toBe(true)
    expect(matches(exp(), found({ line: 50, startLine: 45 }))).toBe(false)
    expect(matches(exp(), found({ line: 41 }), 11)).toBe(true)
  })
})

describe('scoreCase', () => {
  it('uses a judge assignment instead of locations when given', () => {
    const score = scoreCase(
      item('positive', [exp(), exp(), exp(), exp()]),
      'security',
      [found({ path: 'elsewhere.ts', line: 900 }), found()],
      [0, 0, 7, -2],
    )
    expect(score).toMatchObject({ expected: 4, matched: 1, unmatched: 1 })
    expect(scoreCase(item('positive', [exp()]), 'security', [found()], [0.5])).toMatchObject({
      matched: 0,
    })
    expect(scoreCase(item('positive', [exp()]), 'security', [found()], [])).toMatchObject({
      matched: 0,
    })
  })

  it('matches each finding at most once and tracks severity agreement', () => {
    const score = scoreCase(
      item('positive', [exp(), exp({ severity: 'blocking' }), exp({ pillar: 'rules' })]),
      'security',
      [found({ severity: 'low' }), found({ severity: 'blocking' }), found({ line: 500 })],
    )
    expect(score).toEqual({
      id: 'c',
      kind: 'positive',
      expected: 2,
      matched: 2,
      severityAgreed: 1,
      falseAlarms: 0,
      findings: 3,
      unmatched: 1,
    })
  })

  it('skips unmatched expectations', () => {
    expect(scoreCase(item('positive', [exp()]), 'security', [])).toMatchObject({
      expected: 1,
      matched: 0,
      severityAgreed: 0,
    })
  })

  it('counts blocking and high findings on negatives as false alarms', () => {
    const score = scoreCase(item('negative', []), 'security', [
      found({ severity: 'blocking' }),
      found({ severity: 'high' }),
      found({ severity: 'medium' }),
    ])
    expect(score).toMatchObject({ falseAlarms: 2, findings: 3, unmatched: 3 })
    expect(scoreCase(item('positive', [exp()]), 'security', [found()]).falseAlarms).toBe(0)
  })
})

describe('summaries', () => {
  const score = (overrides: Partial<CaseScore>): CaseScore => ({
    id: 'x',
    kind: 'positive',
    expected: 0,
    matched: 0,
    severityAgreed: 0,
    falseAlarms: 0,
    findings: 0,
    unmatched: 0,
    ...overrides,
  })

  it('returns nulls for no scores', () => {
    expect(summarizePillar('rules', [])).toEqual({
      pillar: 'rules',
      cases: 0,
      recall: null,
      severityAgreement: null,
      negativeCases: 0,
      falseAlarmRate: null,
      meanFindings: null,
    })
  })

  it('computes recall, agreement, false alarm rate, and mean findings', () => {
    const summary = summarizePillar('rules', [
      score({ expected: 2, matched: 1, severityAgreed: 1, findings: 2 }),
      score({ kind: 'negative', falseAlarms: 1, findings: 1 }),
      score({ kind: 'negative' }),
    ])
    expect(summary).toMatchObject({
      cases: 3,
      recall: 0.5,
      severityAgreement: 1,
      negativeCases: 2,
      falseAlarmRate: 0.5,
    })
    expect(summary.meanFindings).toBeCloseTo(1)
  })

  it('renders a markdown table with n/a for missing data', () => {
    const table = renderSummaryTable([
      summarizePillar('rules', []),
      {
        pillar: 'design',
        cases: 4,
        recall: 0.666,
        severityAgreement: 1,
        negativeCases: 2,
        falseAlarmRate: 0.5,
        meanFindings: 1.25,
      },
    ])
    expect(table.split('\n')).toEqual([
      '| Pillar | Cases | Recall | Severity agreement | False alarms (negatives) | Findings per PR |',
      '| --- | --- | --- | --- | --- | --- |',
      '| rules | 0 | n/a | n/a | n/a (0) | n/a |',
      '| design | 4 | 67% | 100% | 50% (2) | 1.3 |',
    ])
  })
})
