// Pure `gh api` shell-argument scanner: detects an unquoted `?` or `&` in a `gh api` call's
// argument list. An unquoted `&` backgrounds the command and drops every argument after it — the
// truncated call still exits 0, so CI can report success on a silently short-circuited query. An
// unquoted `?` fails loudly under zsh glob-nomatch but passes through unexpanded under bash. See
// ./yaml.mts and ./index.mts for what feeds this and how it maps hits back to source locations.
//
// This is a small heuristic scanner, not a shell parser: it tracks quote state, backslash
// escapes, and `$(...)` command-substitution nesting per logical line (physical lines joined
// across a trailing, unescaped `\`). It stops once it finds the first unsafe character in a
// call's argument list. A general-purpose shell tokenizer whose "expandable" notion conflates
// glob metacharacters with `$`/backtick expansion would false-positive on a quoted
// `"…${VAR}…?per_page=1"`, so this scanner tracks its own narrower quote-state machine instead.

export type ShellQuotingHit = { offset: number; excerpt: string }

const GH_API_BOUNDARY = /[\s;|&(){}]/
const GH_API_HEAD = /^gh[ \t]+api\b/

function matchGhApiHead(text: string, index: number): number {
  if (index > 0 && !GH_API_BOUNDARY.test(text[index - 1]!)) return 0
  const match = GH_API_HEAD.exec(text.slice(index))
  return match ? match[0].length : 0
}

function excerptAround(text: string, index: number): string {
  return text.slice(Math.max(0, index - 24), Math.min(text.length, index + 12)).trim()
}

// One quoting context: the top-level command, or one level of `$(...)` command substitution.
// Double quotes do not suppress `$(...)`, and quoting inside a substitution is independently
// tracked from its enclosing context — `VAR="$(gh api "…?a=1&b=2")"` is a common idiom for
// capturing a `gh api` response — so a frame stack models that instead of one flat quote state.
// `parenDepth` counts unquoted parens opened since this frame's `$(`, so a nested `$(`, a
// subshell, or `$((...))` arithmetic all close on their own matching `)`.
type Frame = {
  inSingleQuote: boolean
  inDoubleQuote: boolean
  scanningArgs: boolean
  parenDepth: number
}

function newFrame(): Frame {
  return { inSingleQuote: false, inDoubleQuote: false, scanningArgs: false, parenDepth: 0 }
}

function pushSubstitutionFrame(stack: Frame[]): void {
  const frame = newFrame()
  frame.parenDepth = 1
  stack.push(frame)
}

// Scans one already-joined logical line for `gh api` calls and returns at most one hit per call —
// the first unquoted `?` or `&`, whichever comes first. `offsets[k]` maps character k of `text`
// back to its absolute offset in the original source, so callers can report real line numbers.
function scanLogicalLine(text: string, offsets: number[]): ShellQuotingHit[] {
  const hits: ShellQuotingHit[] = []
  const stack: Frame[] = [newFrame()]
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
    if (frame.inDoubleQuote) {
      if (char === '"') {
        frame.inDoubleQuote = false
        i += 1
        continue
      }
      if (char === '$' && text[i + 1] === '(') {
        pushSubstitutionFrame(stack)
        i += 2
        continue
      }
      i += 1
      continue
    }
    if (char === '#' && (i === 0 || /\s/.test(text[i - 1]!))) break
    if (char === "'") {
      frame.inSingleQuote = true
      i += 1
      continue
    }
    if (char === '"') {
      frame.inDoubleQuote = true
      i += 1
      continue
    }
    if (char === '$' && text[i + 1] === '(') {
      pushSubstitutionFrame(stack)
      i += 2
      continue
    }
    if (stack.length > 1 && (char === '(' || char === ')')) {
      frame.parenDepth += char === '(' ? 1 : -1
      i += 1
      if (frame.parenDepth === 0) stack.pop()
      continue
    }
    if (frame.scanningArgs) {
      if (char === ';' || char === '|') {
        frame.scanningArgs = false
        i += 1
        continue
      }
      if (char === '&') {
        if (text[i + 1] === '&') {
          frame.scanningArgs = false
          i += 2
          continue
        }
        // A `&` preceded by whitespace is a delimiter — Bash's background operator ending a
        // fully-formed command (`gh api "repos/x/y" &`) — not a query-string separator embedded
        // in an unquoted argument. A `&` preceded by `>` or `<` is a file-descriptor-duplication
        // redirect (`2>&1`, `>&2`, `<&3`), also never an argument character. Only an `&` embedded
        // in an unquoted argument is unsafe.
        const precededByDelimiter = i > 0 && /[ \t><]/.test(text[i - 1]!)
        if (!precededByDelimiter)
          hits.push({ offset: offsets[i]!, excerpt: excerptAround(text, i) })
        frame.scanningArgs = false
        i += 1
        continue
      }
      if (char === '?') {
        hits.push({ offset: offsets[i]!, excerpt: excerptAround(text, i) })
        frame.scanningArgs = false
        i += 1
        continue
      }
    }
    const headLength = frame.scanningArgs ? 0 : matchGhApiHead(text, i)
    if (headLength > 0) {
      frame.scanningArgs = true
      i += headLength
      continue
    }
    i += 1
  }
  return hits
}

// A logical line joins physical lines across a trailing, unescaped `\` — bash line continuation —
// so a `gh api \` / URL-on-next-line split (common in multi-line `run:` steps) is scanned as one
// command instead of two truncated fragments.
function endsWithLineContinuation(line: string): boolean {
  let backslashRun = 0
  for (let i = line.length - 1; i >= 0 && line[i] === '\\'; i -= 1) backslashRun += 1
  return backslashRun % 2 === 1
}

function joinLogicalLines(source: string): Array<{ text: string; offsets: number[] }> {
  const lines: Array<{ text: string; offsets: number[] }> = []
  let position = 0
  while (position <= source.length) {
    let text = ''
    const offsets: number[] = []
    for (;;) {
      const newlineIndex = source.indexOf('\n', position)
      const lineEnd = newlineIndex === -1 ? source.length : newlineIndex
      const physical = source.slice(position, lineEnd)
      const continues = endsWithLineContinuation(physical)
      const contentEnd = continues ? physical.length - 1 : physical.length
      for (let i = 0; i < contentEnd; i += 1) {
        text += physical[i]
        offsets.push(position + i)
      }
      position = lineEnd + 1
      if (!continues || newlineIndex === -1) break
    }
    lines.push({ text, offsets })
    if (position > source.length) break
  }
  return lines
}

export function lineNumberAt(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i += 1) if (source[i] === '\n') line += 1
  return line
}

/** Hits in `text` with offsets relative to `text` itself, not any enclosing document. */
export function ghApiShellQuotingHits(text: string): ShellQuotingHit[] {
  const hits: ShellQuotingHit[] = []
  for (const logicalLine of joinLogicalLines(text)) {
    hits.push(...scanLogicalLine(logicalLine.text, logicalLine.offsets))
  }
  return hits
}
