// A quote-aware walk over shell text for callers that need per-character positions rather than
// tokens (for example to report offsets). It tracks single and double quotes, backslash escapes,
// unquoted `#` comments, and `$(...)` nesting, giving each nesting level its own caller-defined
// state. Unlike `tokenizeShellWordsDetailed` it never classifies expansion or glob characters, so a
// quoted `"...${VAR}...?x=1"` yields no unquoted `?` to the visitor.

type Frame<State> = {
  inSingleQuote: boolean
  inDoubleQuote: boolean
  parenDepth: number
  state: State
}

function newFrame<State>(state: State, parenDepth: number): Frame<State> {
  return { inSingleQuote: false, inDoubleQuote: false, parenDepth, state }
}

/**
 * Calls `visit(index, state)` for every character outside quotes, escapes, comments, and the
 * structural `$(` / `(` / `)` of a substitution. `state` belongs to the current `$(...)` level. The
 * visitor returns the next index to consume from, or `undefined` to advance by one. Backslash
 * escapes consume the following character, even inside double quotes, and a `#` at the start or
 * after whitespace ends the text.
 */
export function walkUnquotedShell<State>(
  text: string,
  createState: () => State,
  visit: (index: number, state: State) => number | undefined,
): void {
  const stack: Array<Frame<State>> = [newFrame(createState(), 0)]
  let i = 0
  while (i < text.length) {
    const frame = stack[stack.length - 1]!
    const char = text[i]!
    if (frame.inSingleQuote) {
      if (char === "'") frame.inSingleQuote = false
      i += 1
      continue
    }
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === '$' && text[i + 1] === '(') {
      stack.push(newFrame(createState(), 1))
      i += 2
      continue
    }
    if (frame.inDoubleQuote) {
      if (char === '"') frame.inDoubleQuote = false
      i += 1
      continue
    }
    if (char === '#' && (i === 0 || /\s/.test(text[i - 1]!))) break
    if (char === "'" || char === '"') {
      if (char === "'") frame.inSingleQuote = true
      else frame.inDoubleQuote = true
      i += 1
      continue
    }
    if (stack.length > 1 && (char === '(' || char === ')')) {
      frame.parenDepth += char === '(' ? 1 : -1
      i += 1
      if (frame.parenDepth === 0) stack.pop()
      continue
    }
    i = visit(i, frame.state) ?? i + 1
  }
}
