import { skipLiteralOrComment } from './manifest-version-skips.mts'

export type Expectation = { expression: string; expected: string; index: number }

const EXPECTATION_MATCHER =
  /^\s*(?:\.|\?\.)\s*(?:not\s*\.\s*)?to(?:Be|Equal|StrictEqual|MatchObject|Contain|ContainEqual|HaveProperty)\s*\(/u

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
