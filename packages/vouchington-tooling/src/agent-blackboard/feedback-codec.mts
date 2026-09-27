import {
  normalizeRepositories,
  validateFeedbackText,
  validateFeedbackReferences,
} from './feedback-fields.mts'
export { normalizeRepositories } from './feedback-fields.mts'
import { isCount, isObject } from './snapshot-partition-guards.mts'
import type { FeedbackEnvelope } from './feedback-types.mts'

const FEEDBACK_MAX_BYTES = 16_384
const OUTCOMES = [
  'in-progress',
  'success',
  'failure',
  'cancelled',
  'timed-out',
  'no-change',
  'policy-refusal',
  'unknown',
]
const COVERAGE = ['complete', 'partial', 'unavailable', 'not-assessed', 'not-started']
const FIELDS = [
  'schemaVersion',
  'type',
  'sourceEventId',
  'timestamp',
  'repositories',
  'markdown',
  'workOutcome',
  'feedbackCoverage',
  'category',
  'date',
  'issues',
  'prs',
]

export function validateFeedbackEnvelope(value: unknown): asserts value is FeedbackEnvelope {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    typeof value.type !== 'string' ||
    !['journal', 'retrospective'].includes(value.type)
  )
    throw new Error('invalid feedback storage type or schemaVersion')
  if (Object.keys(value).some((key) => !FIELDS.includes(key)))
    throw new Error('unsupported feedback field')
  validateFeedbackText(value.sourceEventId, 'sourceEventId', 256)
  if (!/^[A-Za-z0-9._:-]+$/.test(value.sourceEventId))
    throw new Error('sourceEventId must be URL-safe')
  validateFeedbackText(value.timestamp, 'timestamp', 40)
  if (
    !Number.isFinite(Date.parse(value.timestamp)) ||
    new Date(value.timestamp).toISOString() !== value.timestamp
  )
    throw new Error('timestamp must be a canonical ISO date-time')
  if (
    JSON.stringify(value.repositories) !== JSON.stringify(normalizeRepositories(value.repositories))
  )
    throw new Error('repositories must be canonical')
  validateFeedbackText(value.markdown, 'markdown', 12_000)
  if (typeof value.workOutcome !== 'string' || !OUTCOMES.includes(value.workOutcome))
    throw new Error('workOutcome must be explicit')
  if (
    !isObject(value.feedbackCoverage) ||
    typeof value.feedbackCoverage.status !== 'string' ||
    !COVERAGE.includes(value.feedbackCoverage.status) ||
    !isCount(value.feedbackCoverage.droppedCount)
  )
    throw new Error('feedbackCoverage must be explicit')
  if (
    Object.keys(value.feedbackCoverage).some(
      (key) => !['status', 'sources', 'droppedCount'].includes(key),
    )
  )
    throw new Error('unsupported feedbackCoverage field')
  if (!Array.isArray(value.feedbackCoverage.sources) || value.feedbackCoverage.sources.length > 32)
    throw new Error('coverage sources must be bounded')
  for (const source of value.feedbackCoverage.sources)
    validateFeedbackText(source, 'coverage source', 160)
  if (value.feedbackCoverage.status === 'complete' && value.feedbackCoverage.droppedCount !== 0)
    throw new Error('complete coverage cannot have dropped records')
  if (value.category !== undefined) validateFeedbackText(value.category, 'category', 160)
  if (value.type === 'retrospective' || value.date !== undefined) {
    if (
      typeof value.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
      !Number.isFinite(Date.parse(value.date)) ||
      new Date(value.date).toISOString().slice(0, 10) !== value.date
    )
      throw new Error('date must be a valid YYYY-MM-DD')
  }
  if (value.type === 'retrospective' || value.issues !== undefined)
    validateFeedbackReferences(value.issues, 'issues')
  if (value.type === 'retrospective' || value.prs !== undefined)
    validateFeedbackReferences(value.prs, 'prs')
  if (Buffer.byteLength(JSON.stringify(value)) > FEEDBACK_MAX_BYTES)
    throw new Error('feedback envelope is too large')
}
export function redactFeedbackText(value: string, knownSensitiveValues: string[] = []): string {
  let result = value
  for (const secret of knownSensitiveValues)
    if (secret.length >= 4) result = result.split(secret).join('[REDACTED]')
  return result
    .replace(/\b(?:abb_sk_|gh[pousr]_|github_pat_|sk-(?:proj-)?)?[A-Za-z0-9_-]{30,}\b/g, (match) =>
      /^(?:abb_sk_|gh[pousr]_|github_pat_|sk-)/.test(match) ? '[REDACTED]' : match,
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(
      /((?:password|secret|token|api[_-]?key)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    )
}
export function createFeedbackEnvelope(
  input: FeedbackEnvelope,
  options: { knownSensitiveValues?: string[] } = {},
): FeedbackEnvelope {
  validateFeedbackText(input.markdown, 'markdown', 12_000)
  validateFeedbackText(input.timestamp, 'timestamp', 40)
  const envelope: FeedbackEnvelope = {
    ...input,
    repositories: normalizeRepositories(input.repositories),
    markdown: redactFeedbackText(input.markdown, options.knownSensitiveValues),
    timestamp: Number.isFinite(Date.parse(input.timestamp))
      ? new Date(input.timestamp).toISOString()
      : input.timestamp,
    feedbackCoverage: {
      ...input.feedbackCoverage,
      sources: input.feedbackCoverage.sources.map((source) =>
        redactFeedbackText(source, options.knownSensitiveValues),
      ),
    },
    ...(input.category === undefined
      ? {}
      : { category: redactFeedbackText(input.category, options.knownSensitiveValues) }),
    ...(input.issues === undefined
      ? {}
      : {
          issues: input.issues.map((ref) =>
            typeof ref === 'string' ? redactFeedbackText(ref, options.knownSensitiveValues) : ref,
          ),
        }),
    ...(input.prs === undefined
      ? {}
      : {
          prs: input.prs.map((ref) =>
            typeof ref === 'string' ? redactFeedbackText(ref, options.knownSensitiveValues) : ref,
          ),
        }),
  }
  validateFeedbackEnvelope(envelope)
  return envelope
}
