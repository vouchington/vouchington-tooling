const CONTROL_CHARACTERS = /\p{Cc}+/gu
const MARKDOWN_CHARACTERS = /\\|`|\*|_|\[|\]|<|>/g

export function normalizeAuditText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, ' ').trim()
}

export function isSafeAuditText(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value === normalizeAuditText(value)
}

export function markdownAuditText(value: string): string {
  return normalizeAuditText(value).slice(0, 120).replace(MARKDOWN_CHARACTERS, '\\$&')
}
