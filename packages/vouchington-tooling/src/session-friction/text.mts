const CONTROL_CHARACTERS = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]+/gu
const MARKDOWN_CHARACTER = /\\|`|\*|_|\[|\]|<|>|#|-|\+|!|\|/
const MARKDOWN_AUDIT_MAX_LENGTH = 120

export function normalizeAuditText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, ' ').trim()
}

export function isSafeAuditText(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value === normalizeAuditText(value)
}

export function markdownAuditText(value: string): string {
  let result = ''
  for (const character of normalizeAuditText(value)) {
    const escaped = MARKDOWN_CHARACTER.test(character) ? `\\${character}` : character
    if (result.length + escaped.length > MARKDOWN_AUDIT_MAX_LENGTH) break
    result += escaped
  }
  return result
}
