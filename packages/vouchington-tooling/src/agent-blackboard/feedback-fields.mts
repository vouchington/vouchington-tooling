import { isWellFormedUnicode } from '../session-friction/text.mts'
import type { FeedbackReference } from './feedback-types.mts'
export function validateFeedbackText(
  value: unknown,
  label: string,
  maximum: number,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Buffer.byteLength(value) > maximum ||
    !isWellFormedUnicode(value) ||
    // oxlint-disable-next-line no-control-regex -- reject controls at the durable boundary
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
  )
    throw new Error(`${label} must be bounded non-empty Unicode text`)
}
export function normalizeRepositories(value: unknown, required = true): string[] {
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || value.length > 32 || (required && value.length === 0))
    throw new Error('repositories must be a non-empty array of owner/name strings')
  return [
    ...new Set(
      value.map((candidate) => {
        if (typeof candidate !== 'string' || candidate.length > 160)
          throw new Error('repositories must be a non-empty array of owner/name strings')
        const repository = candidate.trim().toLowerCase()
        if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/.test(repository))
          throw new Error('invalid repository attribution')
        return repository
      }),
    ),
  ].sort()
}
export function validateFeedbackReferences(
  value: unknown,
  label: string,
): asserts value is FeedbackReference[] {
  if (!Array.isArray(value) || value.length > 64)
    throw new Error(`${label} must be a bounded reference array`)
  for (const reference of value) {
    if (typeof reference === 'number') {
      if (!Number.isSafeInteger(reference) || reference <= 0)
        throw new Error(`${label} numbers must be positive integers`)
    } else validateFeedbackText(reference, label, 256)
  }
}
