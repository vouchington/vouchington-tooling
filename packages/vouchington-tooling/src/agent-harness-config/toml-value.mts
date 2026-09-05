import type { TomlValue } from './types.mts'

export function formatTomlValue(value: TomlValue): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  const items = value.map((entry) => `  ${JSON.stringify(entry)},`).join('\n')
  return `[\n${items}\n]`
}

function skipSpaceAndComments(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const char = text[index]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === ',') {
      index += 1
      continue
    }
    if (char === '#') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    break
  }
  return index
}

function parseTomlString(text: string, start: number): { end: number; value: string } {
  const quote = text[start]
  let index = start + 1
  let value = ''
  while (index < text.length) {
    const char = text[index]
    if (char === quote) return { end: index + 1, value }
    if (quote === '"' && char === '\\') {
      const next = text[index + 1]
      if (next === undefined) break
      value += next === 'n' ? '\n' : next === 't' ? '\t' : next
      index += 2
      continue
    }
    value += char
    index += 1
  }
  throw new Error('unterminated TOML string')
}

export function parseTomlValue(
  text: string,
  start: number,
): { end: number; value: boolean | string | string[] } {
  const index = skipSpaceAndComments(text, start)
  if (text.startsWith('true', index)) return { end: index + 4, value: true }
  if (text.startsWith('false', index)) return { end: index + 5, value: false }
  if (text[index] === '"' || text[index] === "'") return parseTomlString(text, index)
  if (text[index] !== '[') throw new Error('unsupported TOML value')
  const items: string[] = []
  let cursor = index + 1
  for (;;) {
    cursor = skipSpaceAndComments(text, cursor)
    if (text[cursor] === ']') return { end: cursor + 1, value: items }
    if (text[cursor] !== '"' && text[cursor] !== "'")
      throw new Error('unsupported TOML array value')
    const parsed = parseTomlString(text, cursor)
    items.push(parsed.value)
    cursor = parsed.end
  }
}
