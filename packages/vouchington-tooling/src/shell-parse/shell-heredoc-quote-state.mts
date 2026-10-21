type Quote = "'" | '"' | null
/** A `$(` still open: the quote state to restore at its `)` and the plain `(` opened inside it. */
type Substitution = { parens: number; restore: Quote }
/** The quote and `$(` nesting a line ends in, carried into the next line of one command. */
export type HeredocLineState = { quote: Quote; substitutions: Substitution[] }

export function newHeredocLineState(): HeredocLineState {
  return { quote: null, substitutions: [] }
}

/**
 * Advances `state` over `char` (`next` follows it) and returns how many extra characters it
 * consumed, or undefined when `char` is plain text the caller still has to read. A `$(` saves the
 * quote it opened in, so the matching `)` restores that quote rather than leaving it unquoted.
 */
export function stepHeredocQuoteState(
  state: HeredocLineState,
  char: string,
  next: string | undefined,
): number | undefined {
  if (state.quote === "'" || (state.quote === '"' && char !== '$')) {
    if (char === state.quote) state.quote = null
    return 0
  }
  if (char === '$' && next === '(') {
    state.substitutions.push({ parens: 0, restore: state.quote })
    state.quote = null
    return 1
  }
  if (state.quote !== null) {
    if (char === state.quote) state.quote = null
    return 0
  }
  const open = state.substitutions.at(-1)
  if (open !== undefined && (char === '(' || char === ')')) {
    if (char === '(') open.parens += 1
    else if (open.parens > 0) open.parens -= 1
    else state.quote = state.substitutions.pop()!.restore
    return 0
  }
  if (char === "'" || char === '"') {
    state.quote = char
    return 0
  }
  return undefined
}
