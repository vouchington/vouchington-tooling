export type Expectation = { expression: string; expected: string; index: number }

const EXPECTATION_MATCHER =
  /^\s*(?:\?\.)?\.\s*(?:not\s*\.\s*)?to(?:Be|Equal|StrictEqual|MatchObject|Contain|ContainEqual|HaveProperty)\s*\(/u

function previousToken(source: string, index: number): string | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (!/\s/u.test(source[cursor]!)) return source[cursor]
  }
  return undefined
}

function skipRegex(source: string, index: number): number {
  const previous = previousToken(source, index)
  if (previous && /[\w$)\]]/u.test(previous)) return index
  let characterClass = false
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1
      continue
    }
    if (source[cursor] === '[') characterClass = true
    if (source[cursor] === ']') characterClass = false
    if (source[cursor] === '/' && !characterClass) return cursor + 1
    if (source[cursor] === '\n') return index
  }
  return index
}

function skipLiteralOrComment(source: string, index: number): number {
  const marker = source[index]
  if (marker === '/' && source[index + 1] === '/') {
    const end = source.indexOf('\n', index + 2)
    return end === -1 ? source.length : end
  }
  if (marker === '/' && source[index + 1] === '*') {
    const end = source.indexOf('*/', index + 2)
    return end === -1 ? source.length : end + 2
  }
  if (marker === '/') return skipRegex(source, index)
  if (marker !== "'" && marker !== '"' && marker !== '`') return index
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1
      continue
    }
    if (source[cursor] === marker) return cursor + 1
  }
  return source.length
}

function closingParenthesis(source: string, open: number): number {
  let depth = 1
  for (let cursor = open + 1; cursor < source.length; cursor += 1) {
    const skipped = skipLiteralOrComment(source, cursor)
    if (skipped !== cursor) {
      cursor = skipped - 1
      continue
    }
    if (source[cursor] === '(') depth += 1
    if (source[cursor] === ')') depth -= 1
    if (depth === 0) return cursor
  }
  return -1
}

export function findExpectations(source: string): Expectation[] {
  const found: Expectation[] = []
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const skipped = skipLiteralOrComment(source, cursor)
    if (skipped !== cursor) {
      cursor = skipped - 1
      continue
    }
    if (!source.startsWith('expect', cursor) || /[\w$]/u.test(source[cursor - 1] ?? '')) continue
    let open = cursor + 'expect'.length
    while (/\s/u.test(source[open] as string)) open += 1
    if (source[open] !== '(') continue
    const expressionEnd = closingParenthesis(source, open)
    if (expressionEnd === -1) continue
    const matcher = source.slice(expressionEnd + 1).match(EXPECTATION_MATCHER)
    if (!matcher) continue
    const expectedOpen = expressionEnd + 1 + matcher[0].length - 1
    const expectedEnd = closingParenthesis(source, expectedOpen)
    if (expectedEnd === -1) continue
    found.push({
      expression: source.slice(open + 1, expressionEnd),
      expected: source.slice(expectedOpen + 1, expectedEnd),
      index: cursor,
    })
    cursor = expectedEnd
  }
  return found
}
