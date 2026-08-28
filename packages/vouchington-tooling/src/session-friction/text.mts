const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]+/gu
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
