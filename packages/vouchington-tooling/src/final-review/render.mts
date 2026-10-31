import type { Effort, FinalReviewInput, Finding, Severity, SkippedPillar } from './finding.mts'

export type Verdict = 'Approve' | 'Request Changes' | 'Comment'

/** Label a final approval carries; agents remove it before any re-review. */
export const FINAL_APPROVAL_LABEL = 'final approval'

const SHORT_BODY_CHARS = 400
const SHORT_BODY_LINES = 4

/** Any blocking finding requests changes, any high finding comments, otherwise approve. */
export function deriveVerdict(findings: readonly Finding[]): Verdict {
  if (findings.some((finding) => finding.severity === 'blocking')) return 'Request Changes'
  if (findings.some((finding) => finding.severity === 'high')) return 'Comment'
  return 'Approve'
}

export function severityTag(severity: Severity): string {
  return `[${severity}]`
}

export function locationText(finding: Finding): string {
  if (finding.path === undefined) return ''
  if (finding.line === undefined) return `\`${finding.path}\``
  const range = finding.startLine === undefined ? '' : `${finding.startLine}-`
  return `\`${finding.path}:${range}${finding.line}\``
}

function detail(summary: string, body: string): string {
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`
}

function isShort(body: string): boolean {
  return body.length <= SHORT_BODY_CHARS && body.split('\n').length <= SHORT_BODY_LINES
}

/** Renders a finding: tag and title up front, short bodies inline, long bodies collapsed. */
export function renderFindingBody(finding: Finding): string {
  const head = `**${severityTag(finding.severity)}** ${finding.title}\n\n<sub>${finding.pillar}</sub>`
  const body = isShort(finding.body) ? finding.body : detail('Details', finding.body)
  return `${head}\n\n${body}`
}

/** Renders a finding that has no commentable diff line, for the review body. */
export function renderBodyFinding(finding: Finding): string {
  const where = locationText(finding)
  const summary = `${severityTag(finding.severity)} ${finding.title}${where ? ` (${where})` : ''}`
  return detail(summary.replace(/`/gu, ''), `<sub>${finding.pillar}</sub>\n\n${finding.body}`)
}

const ORDER: readonly Severity[] = ['blocking', 'high', 'medium', 'low']

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
}

function counts(findings: readonly Finding[]): string {
  if (findings.length === 0) return 'no findings'
  const parts = ORDER.flatMap((severity) => {
    const count = findings.filter((finding) => finding.severity === severity).length
    return count === 0 ? [] : [`${count} ${severity}`]
  })
  const noun = findings.length === 1 ? 'finding' : 'findings'
  return `${findings.length} ${noun} (${parts.join(', ')})`
}

/** Hidden marker other agents parse to tie a review and its label to one head SHA. */
export function reviewMarker(headSha: string, verdict: Verdict, effort: Effort): string {
  return `<!-- final-review sha=${headSha} verdict=${verdict.replace(' ', '-')} effort=${effort} -->`
}

function skippedSection(skipped: readonly SkippedPillar[]): string[] {
  if (skipped.length === 0) return []
  const rows = skipped.map((entry) => `- **${entry.pillar}**: ${entry.reason}`).join('\n')
  return [detail(`Skipped pillars (${skipped.length})`, rows)]
}

/** Renders the review's top section: verdict, reviewed SHA, summary, and the finding index. */
export function renderHeader(input: FinalReviewInput, headSha: string): string {
  const verdict = deriveVerdict(input.findings)
  const index = sortFindings(input.findings).map((finding) => {
    const where = locationText(finding)
    return `- **${severityTag(finding.severity)}** ${finding.title}${where ? ` — ${where}` : ''}`
  })
  return [
    reviewMarker(headSha, verdict, input.effort),
    `## [${verdict}] Final review`,
    `Reviewed \`${headSha.slice(0, 12)}\` at ${input.effort} effort · ${counts(input.findings)}`,
    ...(input.summary ? [input.summary] : []),
    ...(index.length > 0 ? [index.join('\n')] : []),
    ...skippedSection(input.skipped),
  ].join('\n\n')
}
