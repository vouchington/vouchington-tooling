const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]+/gu
const MARKDOWN_CHARACTER = /\\|`|\*|_|~|\[|\]|<|>|#|-|\+|!|\||&/

export function normalizeAuditText(value: string): string {
  return value.replace(CONTROL_CHARACTERS, ' ').trim()
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

const CUT_MARKER = '…'
const WHITESPACE = /^\s$/u

/**
 * Joins escaped units whole, or, when over `maxBytes`, keeps only complete whitespace-separated
 * tokens (so URLs and SHAs are never split) and marks the cut. Never ends in whitespace.
 */
export function fitUnits(units: string[], maxBytes: number): string {
  const whole = units.join('')
  if (Buffer.byteLength(whole) <= maxBytes) return whole
  const room = maxBytes - Buffer.byteLength(` ${CUT_MARKER}`)
  let used = 0
  let boundary = 0
  for (const [index, unit] of units.entries()) {
    used += Buffer.byteLength(unit)
    if (used > room) break
    if (WHITESPACE.test(unit)) boundary = index
  }
  const kept = units.slice(0, boundary).join('').trimEnd()
  return kept ? `${kept} ${CUT_MARKER}` : CUT_MARKER
}
