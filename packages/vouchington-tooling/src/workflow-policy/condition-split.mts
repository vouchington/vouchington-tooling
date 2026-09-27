export function splitTopLevel(expression: string, operator: '&&' | '||'): string[] {
  const segments: string[] = []
  let depth = 0
  let start = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index]
    if (char === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote
    else if (char === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote
    else if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(') depth += 1
      else if (char === ')') depth -= 1
      else if (depth === 0 && expression.startsWith(operator, index)) {
        segments.push(expression.slice(start, index))
        index += operator.length - 1
        start = index + 1
      }
    }
  }
  segments.push(expression.slice(start))
  const trimmedSegments: string[] = []
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (trimmed.length > 0) trimmedSegments.push(trimmed)
  }
  return trimmedSegments
}

/** Strips one layer of enclosing parens — only when the opening `(` at index 0 is the match for
 *  the closing `)` at the end, not e.g. `(a) && (b)` which merely starts and ends with parens. */

export function hasTopLevelMixedOperators(expression: string): boolean {
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let sawAnd = false
  let sawOr = false
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index]
    if (char === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote
    else if (char === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote
    else if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(') depth += 1
      else if (char === ')') depth -= 1
      else if (depth === 0 && expression.startsWith('&&', index)) sawAnd = true
      else if (depth === 0 && expression.startsWith('||', index)) sawOr = true
    }
  }
  return sawAnd && sawOr
}

/**
 * Splits `condition` into its non-status `&&` clauses and its implied status restriction. A status
 * function can appear anywhere among the top-level `&&` clauses (e.g. `always() && vars.X == 'true'`),
 * not just as the entire condition, so every clause is checked rather than only a whole-string match —
 * including wrapped forms like `!cancelled()`, see `classifyStatusClause`. Mixing two different status
 * functions in one condition (`success() && failure()`, never valid in practice) is treated as `other`
 * — the same conservative "can't reason about it" fallback as an unrecognized shape elsewhere in this
 * file. A top-level `&&`/`||` mix, or a status function nested inside an OR branch (e.g.
 * `always() || vars.FORCE`, see `hasStatusFunctionInOrBranch`), is flagged `ambiguous` instead, since
 * neither shape is safe to decompose into clauses.
 */
