import type { AuditSourceInput } from './feedback-audit-source.mts'
import { redactFeedbackText } from './feedback-codec.mts'

export type AuditCaps = { ciBytes: number; sandboxBytes: number }

type AuditInput = AuditSourceInput & { knownSensitiveValues?: string[] | undefined }

const SHRINK_MARGIN_BYTES = 32

/** Rendering attempts: measured shrinks, then every audit group omitted. */
export const AUDIT_ATTEMPTS = 5

export const UNBOUNDED_CAPS: AuditCaps = { ciBytes: Infinity, sandboxBytes: Infinity }

/**
 * Caps for the next attempt after an overflow, scaled by how much of the rendered audit markdown
 * (`auditBytes`) must go. The last attempt allows nothing, leaving only omission notes.
 */
export function shrinkCaps(
  caps: AuditCaps,
  auditBytes: number,
  overflowBytes: number,
  last: boolean,
): AuditCaps {
  if (last) return { ciBytes: 0, sandboxBytes: 0 }
  const keep = Math.max(0, auditBytes - overflowBytes - SHRINK_MARGIN_BYTES) / auditBytes
  const scale = (cap: number): number => Math.floor(Math.min(cap, auditBytes) * keep)
  return { ciBytes: scale(caps.ciBytes), sandboxBytes: scale(caps.sandboxBytes) }
}

/**
 * Audit source with redaction applied to raw field text (escaping first would defeat matching) and
 * byte caps. A caller-supplied redactor runs first, then the built-in one; caller-supplied caps
 * can only lower the computed ones.
 */
export function boundedAuditSource(input: AuditInput, caps: AuditCaps): AuditSourceInput {
  const redactionFor = (caller?: (value: string) => string) => (value: string) =>
    redactFeedbackText(caller ? caller(value) : value, input.knownSensitiveValues)
  const clamp = (caller?: AuditCaps): AuditCaps => ({
    ciBytes: Math.min(caller?.ciBytes ?? Infinity, caps.ciBytes),
    sandboxBytes: Math.min(caller?.sandboxBytes ?? Infinity, caps.sandboxBytes),
  })
  return input.friction
    ? {
        friction: {
          ...input.friction,
          redact: redactionFor(input.friction.redact),
          budgets: clamp(input.friction.budgets),
        },
      }
    : input.journal
      ? {
          journal: {
            ...input.journal,
            redact: redactionFor(input.journal.redact),
            budgets: clamp(input.journal.budgets),
          },
        }
      : {}
}
