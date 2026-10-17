// Commands are matched by command position, not by scanning for words anywhere in
// the string. The string is split into segments on unquoted `;`, `&`, `|` and
// newlines (so `git push;gh pr view` splits even with no surrounding whitespace).
// Quoted spans, including any whitespace inside them, are grouped into a single
// word, mirroring real shell tokenization.
export function splitCommandSegments(command: string): string[][] {
  const segments: string[][] = []
  let current: string[] = []
  let word = ''
  let quote: '"' | "'" | null = null

  const flushWord = (): void => {
    if (word) {
      current.push(word)
      word = ''
    }
  }
  const flushSegment = (): void => {
    flushWord()
    if (current.length) {
      segments.push(current)
      current = []
    }
  }

  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null
      else word += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ';' || char === '&' || char === '|' || char === '\n' || char === '\r') {
      flushSegment()
      continue
    }
    if (/\s/.test(char)) {
      flushWord()
      continue
    }
    word += char
  }
  flushSegment()
  return segments
}

const PACKAGE_RUNNERS = ['npx', 'pnpm', 'pnpx', 'yarn']

export function isPackageRunner(word: string | undefined): boolean {
  if (!word) return false
  return PACKAGE_RUNNERS.some((runner) => word === runner || word.endsWith(`/${runner}`))
}
