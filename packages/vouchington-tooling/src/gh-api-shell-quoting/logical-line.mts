import { walkUnquotedShell } from '../shell-parse/index.mts'
import { consumeArgumentCharacter, type ShellQuotingHit } from './argument-scan.mts'

export type { ShellQuotingHit } from './argument-scan.mts'

const GH_API_BOUNDARY = /[\s;|&(){}]/
const GH_API_HEAD = /^gh[ \t]+api\b/

function matchGhApiHead(text: string, index: number): number {
  if (index > 0 && !GH_API_BOUNDARY.test(text[index - 1]!)) return 0
  const match = GH_API_HEAD.exec(text.slice(index))
  return match ? match[0].length : 0
}

// Scans one already-joined logical line for `gh api` calls and returns at most one hit per call —
// the first unquoted `?` or `&`, whichever comes first. `offsets[k]` maps character k of `text`
// back to its absolute offset in the original source, so callers can report real line numbers.
// Quote, escape, comment, and `$(...)` nesting state comes from `walkUnquotedShell`, which keeps
// each substitution level independent (`VAR="$(gh api "…?a=1&b=2")"` is a common idiom) and, unlike
// the shell tokenizer, does not treat a quoted `${VAR}` as making a later `?` unquoted.
export function scanLogicalLine(text: string, offsets: number[]): ShellQuotingHit[] {
  const hits: ShellQuotingHit[] = []
  walkUnquotedShell(
    text,
    () => ({ scanningArgs: false }),
    (index, frame) => {
      const argumentIndex = consumeArgumentCharacter(text, index, frame, hits, offsets)
      if (argumentIndex !== undefined) return argumentIndex
      const headLength = frame.scanningArgs ? 0 : matchGhApiHead(text, index)
      if (headLength === 0) return undefined
      frame.scanningArgs = true
      return index + headLength
    },
  )
  return hits
}
