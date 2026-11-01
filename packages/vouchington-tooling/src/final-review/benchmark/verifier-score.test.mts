import { describe, expect, it } from 'vitest'

import type { Finding, Severity } from '../finding.mts'
import type { EvalCase } from './cases.mts'
import type { Graded } from './verifier-grade.mts'
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

const graded = (overrides: Partial<Graded> = {}): Graded => ({
  judge: 'j',
  checker: 'k',
  inputs: 'i',
  added: [],
  checks: [],
  ...overrides,
})

describe('scoreVerifierCase', () => {
  it('credits labels raised through real inputs and through added findings', () => {
    // Inputs 0 and 1 are real (copies at 3 and 4); input 2 is noise.
    const input = {
      findings: [finding(), finding(), finding('low'), finding(), finding()],
      real: [
        [0, 0],
        [1, 1],
      ] as Array<[number, number]>,
      planted: [
        [0, 3],
        [1, 4],
      ] as Array<[number, number]>,
    }
    const output = {
      summary: '',
      findings: [finding('blocking'), finding('low'), finding('medium'), finding('blocking')],
      // 0 merges input 0 and its copy; input 1 and its copy stay apart; output 3 is new.
      sources: [[0, 3], [1], [4, 2], []],
    }
    const score = scoreVerifierCase(
      item('positive', ['high', 'high', 'low']),
      input,
      output,
      graded({
        added: [null, null, 0],
        checks: [null, null, null, { holds: false, reason: 'r' }],
      }),
    )
    expect(score).toEqual({
      id: 'c',
      kind: 'positive',
      real: 2,
      kept: 2,
      expected: 3,
      raisedIn: 2,
      raisedOut: 3,
      severityAgreed: 2,
      confirmed: 0,
      refuted: 1,
      planted: 2,
      merged: 1,
      before: 3,
      after: 4,
    })
  })

  it('ignores added assignments past the added findings and counts confirmations', () => {
    const input = { findings: [finding()], real: [[0, 0]] as Array<[number, number]>, planted: [] }
    const output = { summary: '', findings: [finding('high')], sources: [[]] }
    const score = scoreVerifierCase(
      item('negative', ['high']),
      input,
      output,
      graded({ added: [5], checks: [{ holds: true, reason: 'r' }] }),
    )
    expect(score).toMatchObject({ kept: 0, raisedIn: 1, raisedOut: 0, confirmed: 1 })
  })
})

describe('summarizeVerifier and renderVerifierTable', () => {
  const score = (overrides: Partial<VerifierCaseScore>): VerifierCaseScore => ({
    id: 'x',
    kind: 'positive',
    real: 0,
    kept: 0,
    expected: 0,
    raisedIn: 0,
    raisedOut: 0,
    severityAgreed: 0,
    confirmed: 0,
    refuted: 0,
    planted: 0,
    merged: 0,
    before: 0,
    after: 0,
    ...overrides,
  })

  it('renders n/a for empty input', () => {
    expect(renderVerifierTable(summarizeVerifier([])).split('\n')[2]).toBe(
      '| 0 | n/a | n/a → n/a | n/a | n/a (0) | n/a | n/a → n/a |',
    )
  })

  it('computes rates and means', () => {
    const summary = summarizeVerifier([
      score({ real: 2, kept: 1, expected: 4, raisedIn: 1, raisedOut: 2, severityAgreed: 1 }),
      score({
        kind: 'negative',
        confirmed: 3,
        refuted: 1,
        planted: 2,
        merged: 1,
        before: 4,
        after: 2,
      }),
    ])
    expect(summary).toEqual({
      cases: 2,
      keptRate: 0.5,
      recallIn: 0.25,
      recallOut: 0.5,
      severityAgreement: 0.5,
      checked: 4,
      confirmedRate: 0.75,
      mergeRate: 0.5,
      meanBefore: 2,
      meanAfter: 1,
    })
    expect(renderVerifierTable(summary).split('\n')[2]).toBe(
      '| 2 | 50% | 25% → 50% | 50% | 75% (4) | 50% | 2.0 → 1.0 |',
    )
  })
})
