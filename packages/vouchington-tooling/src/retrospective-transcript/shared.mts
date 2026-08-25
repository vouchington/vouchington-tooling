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
  const complete = lines.at(-1)?.trim() ? nonblank.slice(0, -1) : nonblank
  return complete.some((line) => {
    try {
      JSON.parse(line)
      return false
    } catch {
      return true
    }
  })
}

type HereDoc = { delimiter: string; stripTabs: boolean }
function hereDocs(tokens: string[]): HereDoc[] {
  return tokens.flatMap((token, index) => {
    const match = token.match(/^<<(-?)(.*)$/)
    const delimiter = match?.[2] || (match ? tokens[index + 1] : undefined)
    return delimiter ? [{ delimiter, stripTabs: match?.[1] === '-' }] : []
  })
}
function segments(command: string): string[][] {
  const result: string[][] = []
  let segment: string[] = []
  let word = ''
  let quote: string | undefined
  let escaped = false
  let comment = false
  const pending: HereDoc[] = []
  let hereDocLine = ''
  const flush = (): void => {
    if (word) segment.push(word)
    word = ''
  }
  const end = (newline = false): void => {
    flush()
    if (newline) pending.push(...hereDocs(segment))
    if (segment.length) result.push(segment)
    segment = []
  }
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!
    const next = command[index + 1] ?? ''
    if (pending.length) {
      if (char === '\n') {
        const current = pending[0]!
        if (
          (current.stripTabs ? hereDocLine.replace(/^\t+/, '') : hereDocLine) === current.delimiter
        )
          pending.shift()
        hereDocLine = ''
      } else hereDocLine += char
    } else if (comment) {
      if (char === '\n') {
        comment = false
        end(true)
      }
    } else if (escaped) {
      if (char !== '\n') word += char
      escaped = false
    } else if (char === '\\' && next !== '' && /[\\'";#&|\n]/.test(next)) escaped = true
    else if (char === '\\') word += char
    else if (quote) {
      if (char === quote) quote = undefined
      else word += char
    } else if (char === '"' || char === "'") quote = char
    else if (char === '#' && !word) comment = true
    else if (char === ';' || char === '&' || char === '|' || char === '\n') end(char === '\n')
    else if (/\s/.test(char)) flush()
    else word += char
  }
  end()
  return result
}

function commandAfterAssignments(segment: string[]): string[] {
  const index = segment.findIndex((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token))
  return index === -1 ? [] : segment.slice(index)
}

const NO_MISTAKES = /(^|[\\/])no-mistakes(?:\.(?:cmd|exe|bat))?$/i
function containsNoMistakesTarget(tokens: string[]): boolean {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (token === '--') continue
    if (token === '-c' || token === '--call')
      return segments(tokens[index + 1] ?? '').some(isNoMistakes)
    if (token === '--package' || token === '-p') {
      index++
      continue
    }
    if (token.startsWith('-')) continue
    return NO_MISTAKES.test(token)
  }
  return false
}

function isNoMistakes(segment: string[]): boolean {
  const tokens = commandAfterAssignments(segment)
  const [command, second] = tokens
  if (NO_MISTAKES.test(command ?? '')) return true
  if (!['npm', 'npx', 'pnpm', 'pnpx', 'yarn'].includes(command ?? '')) return false
  const offset = second === 'run' || second === 'exec' || second === 'dlx' ? 2 : 1
  return containsNoMistakesTarget(tokens.slice(offset))
}

function isPush(segment: string[]): boolean {
  const tokens = commandAfterAssignments(segment)
  if (!/(^|[\\/])git(?:\.exe)?$/i.test(tokens[0] ?? '')) return false
  for (let index = 1; index < tokens.length; index++) {
    if (['-C', '-c', '--git-dir', '--work-tree'].includes(tokens[index]!)) index++
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
