const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]+/gu
const ILL_FORMED_UTF16 = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const MARKDOWN_CHARACTER = /\\|`|\*|_|~|\[|\]|<|>|#|-|\+|!|\||&/
const MARKDOWN_AUDIT_MAX_LENGTH = 120

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
  return !ILL_FORMED_UTF16.test(value)
}

export function isSafeAuditText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    isWellFormedUnicode(value) &&
    value === normalizeAuditText(value)
  )
}

export function markdownAuditText(value: string): string {
  // Escaping is atomic, so the result may be shorter than the maximum.
  let result = ''
  for (const character of normalizeAuditText(value)) {
    const escaped = MARKDOWN_CHARACTER.test(character) ? `\\${character}` : character
    if (result.length + escaped.length > MARKDOWN_AUDIT_MAX_LENGTH) break
    result += escaped
  }
  return result
}
