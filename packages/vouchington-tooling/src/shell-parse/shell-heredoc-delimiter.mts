export function readHeredocDelimiter(
  line: string,
  startIndex: number,
): { value: string; endIndex: number; expandsSubstitutions: boolean } | null {
  let value = ''
  let cursor = startIndex
  let quote: "'" | '"' | null = null
  let quoted = false

  while (cursor < line.length) {
    const char = line[cursor]!
    if (quote === null && /[\s;&|()<>]/.test(char)) {
      break
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null
        cursor += 1
        continue
      }
      if (quote === '"' && char === '\\' && cursor + 1 < line.length) {
        const nextChar = line[cursor + 1]!
        if (new Set(['$', '`', '"', '\\']).has(nextChar)) {
          value += nextChar
          cursor += 2
          continue
        }
      }
      value += char
      cursor += 1
      continue
    }
    if (char === "'" || char === '"') {
      quoted = true
      quote = char
      cursor += 1
      continue
    }
    if (char === '\\') {
      const nextChar = line[cursor + 1]
      if (nextChar === undefined) {
        return null
      }
      quoted = true
      value += nextChar
      cursor += 2
      continue
    }
    value += char
    cursor += 1
  }

  if (value === '' || quote !== null) {
    return null
  }

  return { value, endIndex: cursor - 1, expandsSubstitutions: !quoted }
}
