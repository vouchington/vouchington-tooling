import type { Severity } from '../finding.mts'
import type { EvalCase } from './cases.mts'
import { creditedOutputs, referencing, type Graded } from './verifier-grade.mts'
import type { VerifierInput } from './verifier-input.mts'
import type { VerifierOutput } from './verifier-run.mts'

export type VerifierCaseScore = {
  id: string
  kind: EvalCase['kind']
  /** Judged-real input findings, and how many survive (directly or through their copy). */
  real: number
  kept: number
  /** Labeled problems, those the pillars raised, and those the verifier's output raises. */
  expected: number
  raisedIn: number
  raisedOut: number
  severityAgreed: number
  /** Uncredited blocking or high output findings an independent check confirmed or refuted. */
  confirmed: number
  refuted: number
  planted: number
  /** Planted pairs that end in exactly one output finding. */
  merged: number
  before: number
  after: number
}

const RANK: Record<Severity, number> = { blocking: 0, high: 1, medium: 2, low: 3 }

export function scoreVerifierCase(
  item: EvalCase,
  input: VerifierInput,
  output: VerifierOutput,
  graded: Graded,
): VerifierCaseScore {
  const kept = input.real.filter(([index]) => {
    const copy = input.planted.find(([original]) => original === index)?.[1]
    return referencing(output, copy === undefined ? [index] : [index, copy]).length > 0
  }).length
  const credited = creditedOutputs(item, input, output, graded.added)
  let raisedOut = 0
  let severityAgreed = 0
  credited.forEach((hits, index) => {
    if (hits.length === 0) return
    raisedOut += 1
    const strongest = Math.min(
      ...hits.map((at) => RANK[(output.findings[at] as { severity: Severity }).severity]),
    )
    const label = (item.expected[index] as { severity: Severity }).severity
    if (Math.abs(strongest - RANK[label]) <= 1) severityAgreed += 1
  })
  const verdicts = graded.checks.filter((check) => check !== null)
  return {
    id: item.id,
    kind: item.kind,
    real: input.real.length,
    kept,
    expected: item.expected.length,
    raisedIn: new Set(input.real.map(([, expected]) => expected)).size,
    raisedOut,
    severityAgreed,
    confirmed: verdicts.filter((check) => check.holds).length,
    refuted: verdicts.filter((check) => !check.holds).length,
    planted: input.planted.length,
    merged: input.planted.filter((pair) => referencing(output, pair).length === 1).length,
    before: input.findings.length - input.planted.length,
    after: output.findings.length,
  }
}

export type VerifierSummary = {
  cases: number
  keptRate: number | null
  recallIn: number | null
  recallOut: number | null
  severityAgreement: number | null
  checked: number
  confirmedRate: number | null
  mergeRate: number | null
  meanBefore: number | null
  meanAfter: number | null
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

export function summarizeVerifier(scores: readonly VerifierCaseScore[]): VerifierSummary {
  const sum = (pick: (score: VerifierCaseScore) => number) =>
    scores.reduce((total, score) => total + pick(score), 0)
  const expected = sum((s) => s.expected)
  const checked = sum((s) => s.confirmed + s.refuted)
  return {
    cases: scores.length,
    keptRate: ratio(
      sum((s) => s.kept),
      sum((s) => s.real),
    ),
    recallIn: ratio(
      sum((s) => s.raisedIn),
      expected,
    ),
    recallOut: ratio(
      sum((s) => s.raisedOut),
      expected,
    ),
    severityAgreement: ratio(
      sum((s) => s.severityAgreed),
      sum((s) => s.raisedOut),
    ),
    checked,
    confirmedRate: ratio(
      sum((s) => s.confirmed),
      checked,
    ),
    mergeRate: ratio(
      sum((s) => s.merged),
      sum((s) => s.planted),
    ),
    meanBefore: ratio(
      sum((s) => s.before),
      scores.length,
    ),
    meanAfter: ratio(
      sum((s) => s.after),
      scores.length,
    ),
  }
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`
}

function mean(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(1)
}

export function renderVerifierTable(summary: VerifierSummary): string {
  return [
    '| Cases | Real kept | Label recall, pillars → verifier | Severity agreement | Other blocking/high confirmed | Duplicates merged | Findings before → after |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    `| ${summary.cases} | ${pct(summary.keptRate)} | ${pct(summary.recallIn)} → ${pct(summary.recallOut)} | ${pct(summary.severityAgreement)} | ${pct(summary.confirmedRate)} (${summary.checked}) | ${pct(summary.mergeRate)} | ${mean(summary.meanBefore)} → ${mean(summary.meanAfter)} |`,
  ].join('\n')
}
