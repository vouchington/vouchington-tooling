const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]+/gu
const MARKDOWN_CHARACTER = /\\|`|\*|_|~|\[|\]|<|>|#|-|\+|!|\||&/

export function normalizeAuditText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, ' ').trim()
}

export function boundedText(value: string, maximum: number): string {
  let end = Math.min(value.length, maximum)
  if (
    end < value.length &&
    /[\uD800-\uDBFF]/.test(value[end - 1]!) &&
    /[\uDC00-\uDFFF]/.test(value[end]!)
  )
    end--
  return value.slice(0, end)
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

export function isSafeAuditText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    isWellFormedUnicode(value) &&
    value === normalizeAuditText(value)
  )
}

export type AuditRedactor = (value: string) => string

/**
 * Splits a field into atomic Markdown-escaped units (one code point, plus its backslash when
 * escaped), so a later cut can never land inside an escape sequence. Redaction runs on the raw
 * text first: escaping inserts backslashes that would otherwise break secret and token matching.
 * normalizeAuditText trims and escaping adds no whitespace, so the result has none at its edges.
 */
export function markdownAuditUnits(value: string, redact?: AuditRedactor): string[] {
  const raw = normalizeAuditText(value)
  return Array.from(redact ? normalizeAuditText(redact(raw)) : raw).map((character) =>
    MARKDOWN_CHARACTER.test(character) ? `\\${character}` : character,
  )
}

export function markdownAuditText(value: string, redact?: AuditRedactor): string {
  return markdownAuditUnits(value, redact).join('')
}
