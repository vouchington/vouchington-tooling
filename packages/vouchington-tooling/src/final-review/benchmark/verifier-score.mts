import type { Severity } from '../finding.mts'
import type { EvalCase } from './cases.mts'
import type { VerifierInput } from './verifier-input.mts'
import type { VerifierOutput } from './verifier-run.mts'

export type VerifierCaseScore = {
  id: string
  kind: EvalCase['kind']
  /** Judged-real input findings, and how many survive (directly or through their copy). */
  real: number
  kept: number
  severityAgreed: number
  planted: number
  /** Planted pairs that end in exactly one output finding. */
  merged: number
  before: number
  after: number
  /** Blocking or high output findings on a negative case. */
  alarms: number
}

const RANK: Record<Severity, number> = { blocking: 0, high: 1, medium: 2, low: 3 }

function referencing(output: VerifierOutput, indexes: readonly number[]): number[] {
  return output.sources.flatMap((list, at) => (list.some((i) => indexes.includes(i)) ? [at] : []))
}

export function scoreVerifierCase(
  item: EvalCase,
  input: VerifierInput,
  output: VerifierOutput,
): VerifierCaseScore {
  let kept = 0
  let severityAgreed = 0
  for (const [index, expectedIndex] of input.real) {
    const copy = input.planted.find(([original]) => original === index)?.[1]
    const hits = referencing(output, copy === undefined ? [index] : [index, copy])
    if (hits.length === 0) continue
    kept += 1
    const expected = item.expected[expectedIndex]
    const strongest = Math.min(
      ...hits.map((at) => RANK[(output.findings[at] as { severity: Severity }).severity]),
    )
    if (expected !== undefined && Math.abs(strongest - RANK[expected.severity]) <= 1) {
      severityAgreed += 1
    }
  }
  const merged = input.planted.filter((pair) => referencing(output, pair).length === 1).length
  return {
    id: item.id,
    kind: item.kind,
    real: input.real.length,
    kept,
    severityAgreed,
    planted: input.planted.length,
    merged,
    before: input.findings.length - input.planted.length,
    after: output.findings.length,
    alarms:
      item.kind === 'negative'
        ? output.findings.filter((finding) => RANK[finding.severity] <= RANK.high).length
        : 0,
  }
}

export type VerifierSummary = {
  cases: number
  keptRate: number | null
  severityAgreement: number | null
  negativeCases: number
  cleanNegativeRate: number | null
  mergeRate: number | null
  meanBefore: number | null
  meanAfter: number | null
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function total(scores: readonly VerifierCaseScore[], pick: (s: VerifierCaseScore) => number) {
  return scores.reduce((sum, score) => sum + pick(score), 0)
}

export function summarizeVerifier(scores: readonly VerifierCaseScore[]): VerifierSummary {
  const negatives = scores.filter((score) => score.kind === 'negative')
  const kept = total(scores, (s) => s.kept)
  return {
    cases: scores.length,
    keptRate: ratio(
      kept,
      total(scores, (s) => s.real),
    ),
    severityAgreement: ratio(
      total(scores, (s) => s.severityAgreed),
      kept,
    ),
    negativeCases: negatives.length,
    cleanNegativeRate: ratio(negatives.filter((s) => s.alarms === 0).length, negatives.length),
    mergeRate: ratio(
      total(scores, (s) => s.merged),
      total(scores, (s) => s.planted),
    ),
    meanBefore: ratio(
      total(scores, (s) => s.before),
      scores.length,
    ),
    meanAfter: ratio(
      total(scores, (s) => s.after),
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
    '| Cases | Real kept | Severity agreement | Clean negatives | Duplicates merged | Findings before → after |',
    '| --- | --- | --- | --- | --- | --- |',
    `| ${summary.cases} | ${pct(summary.keptRate)} | ${pct(summary.severityAgreement)} | ${pct(summary.cleanNegativeRate)} (${summary.negativeCases}) | ${pct(summary.mergeRate)} | ${mean(summary.meanBefore)} → ${mean(summary.meanAfter)} |`,
  ].join('\n')
}
