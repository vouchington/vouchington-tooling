import { describe, expect, it } from 'vitest'

import type { Finding, Severity } from '../finding.mts'
import type { EvalCase } from './cases.mts'
import {
  renderVerifierTable,
  scoreVerifierCase,
  summarizeVerifier,
  type VerifierCaseScore,
} from './verifier-score.mts'

const finding = (severity: Severity = 'high'): Finding => ({
  pillar: 'design',
  severity,
  title: 't',
  body: 'b',
})

function item(kind: EvalCase['kind'], severities: Severity[] = []): EvalCase {
  return {
    id: 'c',
    repo: 'a/b',
    pr: 1,
    title: 't',
    baseSha: 'x',
    headSha: 'y',
    kind,
    reason: '',
    expected: severities.map((severity) => ({
      pillar: 'design',
      severity,
      path: null,
      lines: null,
      claim: 'c',
    })),
  }
}

describe('scoreVerifierCase', () => {
  it('counts kept real findings, severity agreement, and merged duplicates', () => {
    // Inputs: 0 and 1 are real (copies at 3 and 4), 2 is noise.
    const input = {
      findings: [finding(), finding(), finding('low'), finding(), finding()],
      real: [
        [0, 0],
        [1, 1],
        [2, 9],
      ] as Array<[number, number]>,
      planted: [
        [0, 3],
        [1, 4],
      ] as Array<[number, number]>,
    }
    const output = {
      summary: '',
      findings: [finding('blocking'), finding('low'), finding('medium')],
      // 0 and its copy merged; 1 and its copy kept separately; 2 survives with no copy.
      sources: [[0, 3], [1], [4, 2]],
    }
    expect(scoreVerifierCase(item('positive', ['high', 'high']), input, output)).toEqual({
      id: 'c',
      kind: 'positive',
      real: 3,
      kept: 3,
      severityAgreed: 2,
      planted: 2,
      merged: 1,
      before: 3,
      after: 3,
      alarms: 0,
    })
  })

  it('skips dropped real findings and counts alarms on negatives', () => {
    const input = { findings: [finding()], real: [[0, 0]] as Array<[number, number]>, planted: [] }
    const output = { summary: '', findings: [finding('high'), finding('low')], sources: [[], []] }
    expect(scoreVerifierCase(item('negative'), input, output)).toMatchObject({
      kept: 0,
      alarms: 1,
    })
  })
})

describe('summarizeVerifier and renderVerifierTable', () => {
  const score = (overrides: Partial<VerifierCaseScore>): VerifierCaseScore => ({
    id: 'x',
    kind: 'positive',
    real: 0,
    kept: 0,
    severityAgreed: 0,
    planted: 0,
    merged: 0,
    before: 0,
    after: 0,
    alarms: 0,
    ...overrides,
  })

  it('renders n/a for empty input', () => {
    expect(renderVerifierTable(summarizeVerifier([])).split('\n')[2]).toBe(
      '| 0 | n/a | n/a | n/a (0) | n/a | n/a → n/a |',
    )
  })

  it('computes rates and means', () => {
    const summary = summarizeVerifier([
      score({ real: 2, kept: 1, severityAgreed: 1, planted: 2, merged: 1, before: 4, after: 2 }),
      score({ kind: 'negative', alarms: 1, before: 2, after: 1 }),
      score({ kind: 'negative' }),
    ])
    expect(summary).toEqual({
      cases: 3,
      keptRate: 0.5,
      severityAgreement: 1,
      negativeCases: 2,
      cleanNegativeRate: 0.5,
      mergeRate: 0.5,
      meanBefore: 2,
      meanAfter: 1,
    })
    expect(renderVerifierTable(summary).split('\n')[2]).toBe(
      '| 3 | 50% | 100% | 50% (2) | 50% | 2.0 → 1.0 |',
    )
  })
})
