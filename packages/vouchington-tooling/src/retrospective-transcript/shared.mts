export type TokenTotals = {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}
export type TranscriptFacts = {
  userPrompts: number
  assistantResponses: number
  toolCalls: number
  failedToolCalls: number
  noMistakesInvocations: number
  advisorCalls: number
  pushCommandAttempts: number
  compactions: number
  tokens: TokenTotals
  subagentToolCalls: number
  subagentTokens: TokenTotals
}

export type ParsedLine = Record<string, unknown>
export type CodexSegment = { lines: string[]; baseline: TokenTotals }

export const emptyTokens = (): TokenTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
})
export const emptyFacts = (): TranscriptFacts => ({
  userPrompts: 0,
  assistantResponses: 0,
  toolCalls: 0,
  failedToolCalls: 0,
  noMistakesInvocations: 0,
  advisorCalls: 0,
  pushCommandAttempts: 0,
  compactions: 0,
  tokens: emptyTokens(),
  subagentToolCalls: 0,
  subagentTokens: emptyTokens(),
})

export function asRecord(value: unknown): ParsedLine | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ParsedLine)
    : undefined
}

export const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

export function parseLines(lines: string[]): ParsedLine[] {
  const records: ParsedLine[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const record = asRecord(JSON.parse(line))
      if (record) records.push(record)
    } catch {
      // Keep valid records before a partially written final line.
    }
  }
  return records
}

export function hasMalformedInteriorRecord(lines: string[]): boolean {
  const nonblank = lines.filter((line) => line.trim())
  return nonblank.slice(0, -1).some((line) => {
    try {
      JSON.parse(line)
      return false
    } catch {
      return true
    }
  })
}

function segments(command: string): string[][] {
  const result: string[][] = []
  let segment: string[] = []
  let word = ''
  let quote: string | undefined
  let escaped = false
  const flush = (): void => {
    if (word) segment.push(word)
    word = ''
  }
  const end = (): void => {
    flush()
    if (segment.length) result.push(segment)
    segment = []
  }
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    const next = command[index + 1] ?? ''
    if (escaped) {
      if (char !== '\n') word += char
      escaped = false
    } else if (char === '\\' && next !== '' && /[\\'";&|\n]/.test(next)) escaped = true
    else if (char === '\\') word += char
    else if (quote) {
      if (char === quote) quote = undefined
      else word += char
    } else if (char === '"' || char === "'") quote = char
    else if (char === ';' || char === '&' || char === '|' || char === '\n') end()
    else if (/\s/.test(char)) flush()
    else word += char
  }
  if (escaped) word += '\\'
  end()
  return result
}

function commandAfterAssignments(segment: string[]): string[] {
  const index = segment.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token))
  return index === -1 ? [] : segment.slice(index)
}

function isNoMistakes(segment: string[]): boolean {
  const [command, second, third] = commandAfterAssignments(segment)
  if (/(^|[\\/])no-mistakes(?:\.(?:cmd|exe|bat))?$/i.test(command ?? '')) return true
  if (!['npm', 'npx', 'pnpm', 'pnpx', 'yarn'].includes(command ?? '')) return false
  return (
    (second === 'run' || second === 'exec' || second === 'dlx' ? third : second) === 'no-mistakes'
  )
}

function isPush(segment: string[]): boolean {
  const tokens = commandAfterAssignments(segment)
  if (tokens[0] !== 'git' && !tokens[0]?.endsWith('/git')) return false
  for (let index = 1; index < tokens.length; index++) {
    if (tokens[index] === '-C' || tokens[index] === '-c') index++
    else if (!tokens[index]?.startsWith('-')) return tokens[index] === 'push'
  }
  return false
}

export function applyCommand(command: string, facts: TranscriptFacts): void {
  for (const segment of segments(command)) {
    if (isNoMistakes(segment)) facts.noMistakesInvocations++
    if (isPush(segment)) facts.pushCommandAttempts++
  }
}
