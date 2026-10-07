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

// No length cap: every caller's input is already bounded (CI blocks by the 10,000-byte block
// limit, friction events by EVENT_FIELD_MAX_LENGTH/DETAIL_MAX_LENGTH, session IDs by 4096), and
// cutting a field mid-value drops evidence (run URLs, commit SHAs) or leaves trailing whitespace.
// normalizeAuditText trims, and escaping never adds whitespace, so the result has none either.
export function markdownAuditText(value: string): string {
  let result = ''
  for (const character of normalizeAuditText(value))
    result += MARKDOWN_CHARACTER.test(character) ? `\\${character}` : character
  return result
}
