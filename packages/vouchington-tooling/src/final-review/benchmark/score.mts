import type { Finding, Pillar, Severity } from '../finding.mts'
import type { EvalCase, ExpectedFinding } from './cases.mts'

const LINE_TOLERANCE = 10

export type CaseScore = {
  id: string
  kind: EvalCase['kind']
  expected: number
  matched: number
  severityAgreed: number
  /** Blocking or high findings on a negative case. */
  falseAlarms: number
  findings: number
  unmatched: number
}

export type PillarSummary = {
  pillar: Pillar
  cases: number
  recall: number | null
  severityAgreement: number | null
  negativeCases: number
  /** Share of negative cases with at least one blocking or high finding. */
  falseAlarmRate: number | null
  meanFindings: number | null
}

const RANK: Record<Severity, number> = { blocking: 0, high: 1, medium: 2, low: 3 }

function normalize(path: string): string {
  return path.replace(/^\.\//u, '').replace(/^\/+/u, '')
}

/** A finding matches when the path agrees and its line falls near the expected range. */
export function matches(
  expected: ExpectedFinding,
  finding: Finding,
  tolerance = LINE_TOLERANCE,
): boolean {
  if (expected.path === null) return true
  if (finding.path === undefined || normalize(finding.path) !== normalize(expected.path))
    return false
  if (expected.lines === null || finding.line === undefined) return true
  const [start, end] = expected.lines
  const low = (finding.startLine ?? finding.line) - tolerance
  const high = finding.line + tolerance
  return high >= start && low <= end
}

function isAlarm(finding: Finding): boolean {
  return RANK[finding.severity] <= RANK.high
}

/**
 * Scores one pillar's findings for one case; each finding can satisfy one expectation. A judge
 * `assignment` (finding index per expected entry) replaces location matching when given.
 */
export function scoreCase(
  item: EvalCase,
  pillar: Pillar,
  findings: readonly Finding[],
  assignment?: ReadonlyArray<number | null>,
): CaseScore {
  const targets = item.expected.filter((entry) => entry.pillar === pillar)
  const used = new Set<number>()
  let matched = 0
  let severityAgreed = 0
  for (const [position, target] of targets.entries()) {
    const at =
      assignment === undefined
        ? findings.findIndex((finding, index) => !used.has(index) && matches(target, finding))
        : (assignment[position] ?? -1)
    if (!Number.isInteger(at) || at < 0 || at >= findings.length || used.has(at)) continue
    used.add(at)
    matched += 1
    const found = findings[at] as Finding
    if (Math.abs(RANK[found.severity] - RANK[target.severity]) <= 1) severityAgreed += 1
  }
  return {
    id: item.id,
    kind: item.kind,
    expected: targets.length,
    matched,
    severityAgreed,
    falseAlarms: item.kind === 'negative' ? findings.filter(isAlarm).length : 0,
    findings: findings.length,
    unmatched: findings.length - used.size,
  }
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function sum(scores: readonly CaseScore[], pick: (score: CaseScore) => number): number {
  return scores.reduce((total, score) => total + pick(score), 0)
}

export function summarizePillar(pillar: Pillar, scores: readonly CaseScore[]): PillarSummary {
  const negatives = scores.filter((score) => score.kind === 'negative')
  const matched = sum(scores, (score) => score.matched)
  return {
    pillar,
    cases: scores.length,
    recall: ratio(
      matched,
      sum(scores, (score) => score.expected),
    ),
    severityAgreement: ratio(
      sum(scores, (score) => score.severityAgreed),
      matched,
    ),
    negativeCases: negatives.length,
    falseAlarmRate: ratio(
      negatives.filter((score) => score.falseAlarms > 0).length,
      negatives.length,
    ),
    meanFindings: ratio(
      sum(scores, (score) => score.findings),
      scores.length,
    ),
  }
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`
}

/** Renders pillar summaries as a markdown table. */
export function renderSummaryTable(summaries: readonly PillarSummary[]): string {
  const rows = summaries.map(
    (s) =>
      `| ${s.pillar} | ${s.cases} | ${pct(s.recall)} | ${pct(s.severityAgreement)} | ${pct(s.falseAlarmRate)} (${s.negativeCases}) | ${s.meanFindings === null ? 'n/a' : s.meanFindings.toFixed(1)} |`,
  )
  return [
    '| Pillar | Cases | Recall | Severity agreement | False alarms (negatives) | Findings per PR |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}
