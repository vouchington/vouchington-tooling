import {
  runRetrospectiveFactsReport,
  type RetrospectiveFactsOptions,
} from '../retrospective-facts/index.mts'
import {
  runRetrospectiveTranscriptReport,
  type ResolveOptions,
} from '../retrospective-transcript/index.mts'
import type { SessionFrictionReportOptions } from '../session-friction/index.mts'
import {
  assertSingleAuditSource,
  auditAssessed,
  loadAuditInputs,
  renderAuditReport,
  completeCoverageError,
  type AuditReport,
} from './feedback-audit-source.mts'
import {
  AUDIT_ATTEMPTS,
  boundedAuditSource,
  shrinkCaps,
  UNBOUNDED_CAPS,
} from './feedback-compose-audit.mts'
import type { JournalAuditOptions } from './feedback-journal-audit.mts'
import {
  createFeedbackEnvelope,
  feedbackOverflowBytes,
  redactFeedbackText,
} from './feedback-codec.mts'
import { validateFeedbackText } from './feedback-fields.mts'
import type {
  FeedbackCoverage,
  FeedbackEnvelope,
  FeedbackReference,
  WorkOutcome,
} from './feedback-types.mts'
export type FeedbackAssessment = {
  status: 'findings' | 'none-observed' | 'not-assessed' | 'unavailable'
  findings?: Array<{
    observation: string
    evidence: string
    disposition: string
    trackingReference?: string
  }>
  reason?: string
}
type Unassessed = { status: 'unavailable' | 'not-assessed'; reason: string }
export type RetrospectiveCompositionInput = {
  sessionId: string
  date: string
  issues: FeedbackReference[]
  prs: FeedbackReference[]
  description: string
  repositories: string[]
  workOutcome: WorkOutcome
  feedbackCoverage: FeedbackCoverage
  narrative: string
  facts: Omit<RetrospectiveFactsOptions, 'raw'> | Unassessed
  transcript: ResolveOptions | Unassessed
  /** CI failures and sandbox audit from a friction log plus journal. Exclusive with `journal`. */
  friction?: SessionFrictionReportOptions
  /** CI failures and sandbox audit from journal entries alone (`frictionStatus: 'journal-only'`). */
  journal?: JournalAuditOptions
  tools: FeedbackAssessment
  architecture: FeedbackAssessment
  knownSensitiveValues?: string[]
}
function assessment(title: string, value: FeedbackAssessment): string {
  if (!['findings', 'none-observed', 'not-assessed', 'unavailable'].includes(value.status))
    throw new Error('assessment status must be explicit')
  if (
    value.status !== 'findings' &&
    (typeof value.reason !== 'string' ||
      !value.reason.trim() ||
      Buffer.byteLength(value.reason) > 240)
  )
    throw new Error('assessment reason and inspected scope must be explicit and bounded')
  const findings = value.findings ?? []
  if (findings.length > 20 || (value.status === 'findings') !== Boolean(findings.length))
    throw new Error('assessment findings must match status and remain bounded')
  const lines = findings.map((finding) => {
    for (const field of [finding.observation, finding.evidence, finding.disposition])
      if (typeof field !== 'string' || !field.trim() || Buffer.byteLength(field) > 1000)
        throw new Error(
          'assessment finding must contain bounded observation, evidence and disposition',
        )
    if (finding.trackingReference !== undefined)
      validateFeedbackText(finding.trackingReference, 'assessment tracking reference', 240)
    return `- ${finding.observation}\n  - Evidence: ${finding.evidence}\n  - Disposition: ${finding.disposition}${finding.trackingReference ? `\n  - Tracking: ${finding.trackingReference}` : ''}`
  })
  return `## ${title}\nStatus: ${value.status.replaceAll('-', ' ')}${value.reason ? ` (${value.reason})` : ''}\n${lines.join('\n')}`
}
function unavailable(marker: string, input: Unassessed): string {
  if (input.status !== 'unavailable' && input.status !== 'not-assessed')
    throw new Error('unassessed status must be unavailable or not-assessed')
  if (!input.reason.trim() || Buffer.byteLength(input.reason) > 240)
    throw new Error('unavailable reason must be bounded and explicit')
  return `${marker}\nStatus: ${input.status.replaceAll('-', ' ')} (${input.reason})`
}
export async function composeRetrospective(input: RetrospectiveCompositionInput): Promise<string> {
  assertSingleAuditSource(input)
  const unavailableFacts =
    'status' in input.facts
      ? {
          markdown: unavailable('=== Retrospective Facts ===', input.facts),
          coverage: input.facts.status,
        }
      : undefined
  const unavailableTranscript =
    'status' in input.transcript
      ? {
          markdown: unavailable('=== Transcript Facts ===', input.transcript),
          coverage: input.transcript.status,
        }
      : undefined
  const [facts, transcript] = await Promise.all([
    'status' in input.facts
      ? Promise.resolve(unavailableFacts!)
      : runRetrospectiveFactsReport({ ...input.facts, raw: false }),
    'status' in input.transcript
      ? Promise.resolve(unavailableTranscript!)
      : runRetrospectiveTranscriptReport(input.transcript),
  ])
  const assemble = (auditMarkdown: string): string =>
    [
      '---',
      `date: ${JSON.stringify(input.date)}`,
      `issues: ${JSON.stringify(input.issues)}`,
      `prs: ${JSON.stringify(input.prs)}`,
      `session_id: ${JSON.stringify(input.sessionId)}`,
      `description: ${JSON.stringify(input.description)}`,
      `work_outcome: ${JSON.stringify(input.workOutcome)}`,
      `feedback_coverage: ${JSON.stringify(input.feedbackCoverage)}`,
      '---',
      '',
      input.narrative,
      `## Outcome\nWork outcome: ${input.workOutcome}\nFeedback coverage: ${input.feedbackCoverage.status}\nDropped records: ${input.feedbackCoverage.droppedCount}`,
      `## Verifiable Facts\n${facts.markdown.trim()}`,
      `## Transcript Facts\n${transcript.markdown.trim()}`,
      auditMarkdown,
      assessment('Tool Findings', input.tools),
      assessment('Architecture Findings', input.architecture),
    ].join('\n\n')
  const envelopeFor = (markdown: string): FeedbackEnvelope => ({
    schemaVersion: 1,
    type: 'retrospective',
    sourceEventId: 'composition-validation',
    timestamp: `${input.date}T00:00:00.000Z`,
    date: input.date,
    issues: input.issues,
    prs: input.prs,
    repositories: input.repositories,
    markdown: redactFeedbackText(markdown, input.knownSensitiveValues),
    workOutcome: input.workOutcome,
    feedbackCoverage: input.feedbackCoverage,
  })
  // The audit sections are the only unbounded ones: render them, measure the real envelope against
  // its limits, and shrink the audit caps by the measured overflow until it fits.
  const loaded = await loadAuditInputs(input.sessionId, input)
  let caps = UNBOUNDED_CAPS
  let audit: AuditReport
  let markdown: string
  for (let attempt = 1; ; attempt++) {
    audit = renderAuditReport(input.sessionId, boundedAuditSource(input, caps), loaded)
    markdown = assemble(audit.markdown)
    const overflow = feedbackOverflowBytes(envelopeFor(markdown))
    if (!overflow || attempt === AUDIT_ATTEMPTS) break
    caps = shrinkCaps(
      caps,
      Buffer.byteLength(audit.markdown),
      overflow,
      attempt === AUDIT_ATTEMPTS - 1,
    )
  }
  if (
    input.feedbackCoverage.status === 'complete' &&
    (facts.coverage !== 'complete' ||
      transcript.coverage !== 'complete' ||
      ['not-assessed', 'unavailable'].includes(input.tools.status) ||
      ['not-assessed', 'unavailable'].includes(input.architecture.status) ||
      !auditAssessed(audit))
  )
    throw completeCoverageError(input)
  if ((audit.coverage.droppedCount ?? 0) > input.feedbackCoverage.droppedCount)
    throw new Error('feedback coverage dropped count must include observed friction drops')
  return createFeedbackEnvelope(envelopeFor(markdown)).markdown
}
