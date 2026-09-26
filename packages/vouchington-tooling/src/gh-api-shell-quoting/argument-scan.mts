export type ShellQuotingHit = { offset: number; excerpt: string }

function excerptAround(text: string, index: number): string {
  return text.slice(Math.max(0, index - 24), Math.min(text.length, index + 12)).trim()
}

// While `frame.scanningArgs` is set, `;`, `|`, and a real `&` end the argument list. `&&` is the
// Bash and-operator, `2>&1`/`>&2`/`<&3` are fd-duplication redirects, and a whitespace-preceded
// `&` backgrounds the command. Only an `&` or `?` embedded in an unquoted argument is unsafe.
// Returns the next scan index when this character is consumed, otherwise undefined so the caller
// can keep matching a `gh api` head.
export function consumeArgumentCharacter(
  text: string,
  index: number,
  frame: { scanningArgs: boolean },
  hits: ShellQuotingHit[],
  offsets: number[],
): number | undefined {
  if (!frame.scanningArgs) return undefined
  const char = text[index]!
  if (char === ';' || char === '|') {
    frame.scanningArgs = false
    return index + 1
  }
  if (char === '&') {
    if (text[index + 1] === '&') {
      frame.scanningArgs = false
      return index + 2
    }
    if (index > 0 && /[><]/.test(text[index - 1]!)) return index + 1
    if (!(index > 0 && /[ \t]/.test(text[index - 1]!)))
      hits.push({ offset: offsets[index]!, excerpt: excerptAround(text, index) })
    frame.scanningArgs = false
    return index + 1
  }
  if (char === '?') {
    hits.push({ offset: offsets[index]!, excerpt: excerptAround(text, index) })
    frame.scanningArgs = false
    return index + 1
  }
  return undefined
}
