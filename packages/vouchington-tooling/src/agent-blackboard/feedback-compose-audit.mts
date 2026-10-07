import type { AuditSourceInput } from './feedback-audit-source.mts'
import { redactFeedbackText } from './feedback-codec.mts'

const MARKDOWN_MAX_BYTES = 12_000
const ENVELOPE_MAX_BYTES = 16_384
// Frontmatter-independent envelope fields, section headers, and redaction that can lengthen text.
const ENVELOPE_RESERVE_BYTES = 1_500
const AUDIT_HEADERS_BYTES = 600
const SANDBOX_MAX_SHARE = 0.4

type AuditInput = AuditSourceInput & { knownSensitiveValues?: string[] | undefined }

/**
 * Bytes the CI and sandbox audit blocks may add to a retrospective whose other sections are
 * `otherMarkdown`. Escaped text can double under JSON (each backslash), hence half the envelope room.
 */
function auditBudgets(otherMarkdown: string): { ciBytes: number; sandboxBytes: number } {
  const markdownRoom = MARKDOWN_MAX_BYTES - Buffer.byteLength(otherMarkdown)
  const envelopeRoom =
    ENVELOPE_MAX_BYTES - ENVELOPE_RESERVE_BYTES - Buffer.byteLength(JSON.stringify(otherMarkdown))
  const allowance = Math.max(
    0,
    Math.min(markdownRoom, Math.floor(envelopeRoom / 2)) - AUDIT_HEADERS_BYTES,
  )
  const sandboxBytes = Math.floor(allowance * SANDBOX_MAX_SHARE)
  return { ciBytes: allowance - sandboxBytes, sandboxBytes }
}

/**
 * Audit source with redaction applied to raw field text (escaping first would defeat matching) and
 * budgets that fit the other sections. A caller-supplied redactor runs first, then the built-in one.
 */
export function boundedAuditSource(input: AuditInput, otherMarkdown: string): AuditSourceInput {
  const budgets = auditBudgets(otherMarkdown)
  const redactionFor = (caller?: (value: string) => string) => (value: string) =>
    redactFeedbackText(caller ? caller(value) : value, input.knownSensitiveValues)
  return input.friction
    ? { friction: { ...input.friction, redact: redactionFor(input.friction.redact), budgets } }
    : input.journal
      ? { journal: { ...input.journal, redact: redactionFor(input.journal.redact), budgets } }
      : {}
}
