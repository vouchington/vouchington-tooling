import {
  runRetrospectiveFactsReport,
  type RetrospectiveFactsOptions,
} from '../retrospective-facts/index.mts'
import {
  runRetrospectiveTranscriptReport,
  type ResolveOptions,
} from '../retrospective-transcript/index.mts'
import {
  buildSessionFrictionReport,
  type SessionFrictionReportOptions,
  type SessionFrictionReport,
} from '../session-friction/index.mts'
import { createFeedbackEnvelope, redactFeedbackText } from './feedback-codec.mts'
import type { FeedbackCoverage, FeedbackReference, WorkOutcome } from './feedback-types.mts'
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
  friction?: SessionFrictionReportOptions
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
  const [facts, transcript, friction] = await Promise.all([
    'status' in input.facts
      ? Promise.resolve(unavailableFacts!)
      : runRetrospectiveFactsReport({ ...input.facts, raw: false }),
    'status' in input.transcript
      ? Promise.resolve(unavailableTranscript!)
      : runRetrospectiveTranscriptReport(input.transcript),
    input.friction
      ? buildSessionFrictionReport(input.sessionId, input.friction)
      : Promise.resolve<SessionFrictionReport>({
          coverage: {
            journalStatus: 'unavailable' as const,
            frictionStatus: 'absent' as const,
            truncated: false,
          },
          markdown:
            '## CI Failures\nStatus: unavailable (not assessed)\n\n## Sandbox & Permission Audit\nStatus: unavailable (not assessed)',
        }),
  ])
  if (
    input.feedbackCoverage.status === 'complete' &&
    (facts.coverage !== 'complete' ||
      transcript.coverage !== 'complete' ||
      ['not-assessed', 'unavailable'].includes(input.tools.status) ||
      ['not-assessed', 'unavailable'].includes(input.architecture.status) ||
      friction.coverage.journalStatus !== 'complete' ||
      !['empty', 'events'].includes(friction.coverage.frictionStatus) ||
      friction.coverage.truncated)
  )
    throw new Error(
      'complete feedback coverage requires assessed available factual and finding sources',
    )
  if ((friction.coverage.droppedCount ?? 0) > input.feedbackCoverage.droppedCount)
    throw new Error('feedback coverage dropped count must include observed friction drops')
  const markdown = [
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
    friction.markdown,
    assessment('Tool Findings', input.tools),
    assessment('Architecture Findings', input.architecture),
  ].join('\n\n')
  const envelope = createFeedbackEnvelope({
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
  return envelope.markdown
}
