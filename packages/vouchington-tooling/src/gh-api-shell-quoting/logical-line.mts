import { consumeArgumentCharacter, type ShellQuotingHit } from './argument-scan.mts'

export type { ShellQuotingHit } from './argument-scan.mts'

const GH_API_BOUNDARY = /[\s;|&(){}]/
const GH_API_HEAD = /^gh[ \t]+api\b/

function matchGhApiHead(text: string, index: number): number {
  if (index > 0 && !GH_API_BOUNDARY.test(text[index - 1]!)) return 0
  const match = GH_API_HEAD.exec(text.slice(index))
  return match ? match[0].length : 0
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
export function scanLogicalLine(text: string, offsets: number[]): ShellQuotingHit[] {
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
    const argumentIndex = consumeArgumentCharacter(text, i, frame, hits, offsets)
    if (argumentIndex !== undefined) {
      i = argumentIndex
      continue
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
