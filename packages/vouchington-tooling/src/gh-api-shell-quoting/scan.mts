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
import { scanLogicalLine, type ShellQuotingHit } from './logical-line.mts'

export type { ShellQuotingHit } from './logical-line.mts'

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
