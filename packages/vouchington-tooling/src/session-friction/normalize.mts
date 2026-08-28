const MAX_COMMAND_TOKEN_LENGTH = 40
const REDACTED_TOKEN = '…'
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const PACKAGE_RUNNERS = new Set(['npx', 'pnpm', 'pnpx', 'yarn'])
const GIT_OPTIONS_WITH_ARGS = new Set(['-C', '-c'])
const ENV_OPTIONS_WITH_ARGS = new Set(['-C', '--chdir', '-S', '--split-string', '-u', '--unset'])
const GIT_OPTIONS_WITHOUT_ARGS = new Set([
  '-v',
  '--version',
  '-h',
  '--help',
  '--exec-path',
  '--html-path',
  '--man-path',
  '--info-path',
  '-p',
  '--paginate',
  '-P',
  '--no-pager',
  '--no-replace-objects',
  '--bare',
])

function splitCommand(command: string): string[][] {
  const result: string[][] = []
  let segment: string[] = []
  let word = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  const flushWord = (): void => {
    if (word) segment.push(word)
    word = ''
  }
  const flushSegment = (): void => {
    flushWord()
    if (segment.length) result.push(segment)
    segment = []
  }
  for (const char of command) {
    if (escaped) {
      word += char
      escaped = false
    } else if (char === '\\' && quote !== "'") {
      escaped = true
    } else if (quote) {
      if (char === quote) quote = undefined
      else word += char
    } else if (char === '"' || char === "'") quote = char
    else if (';&|\n\r'.includes(char)) flushSegment()
    else if (/\s/.test(char)) flushWord()
    else word += char
  }
  if (escaped) word += '\\'
  flushSegment()
  return result
}

function redact(token: string): string {
  return token.length > MAX_COMMAND_TOKEN_LENGTH ? REDACTED_TOKEN : token
}

function stripAssignments(tokens: string[]): string[] {
  let index = 0
  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index]!)) index++
  const wrapper = tokens[index]
  if (wrapper !== 'env' && !wrapper?.endsWith('/env'))
    return index < tokens.length ? tokens.slice(index) : index ? [REDACTED_TOKEN] : tokens
  index++
  while (index < tokens.length) {
    const option = tokens[index]!
    if (option === '--') {
      index++
      break
    }
    if (ENV_OPTIONS_WITH_ARGS.has(option)) {
      index += 2
      continue
    }
    if (option.startsWith('-')) {
      index++
      continue
    }
    break
  }
  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index]!)) index++
  return index < tokens.length ? tokens.slice(index) : [REDACTED_TOKEN]
}

function stripGitOptions(tokens: string[]): string[] {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    if (token === '--') return tokens.slice(index + 1)
    if (GIT_OPTIONS_WITH_ARGS.has(token)) index += 2
    else if (GIT_OPTIONS_WITHOUT_ARGS.has(token) || /^--[a-z0-9-]+=/i.test(token)) index++
    else break
  }
  return tokens.slice(index)
}

function packageRunner(token: string): boolean {
  return [...PACKAGE_RUNNERS].some((runner) => token === runner || token.endsWith(`/${runner}`))
}

function normalizeSegment(tokens: string[]): string {
  const [first, ...rest] = tokens
  if (!first) return ''
  if (first === 'rtk' && rest.length) return `rtk ${normalizeSegment(rest)}`
  if (packageRunner(first) && (rest[0] === 'run' || rest[0] === 'exec') && rest[1])
    return `${redact(first)} ${rest[0]} ${redact(rest[1])}`
  const effective = first === 'git' ? stripGitOptions(rest) : rest
  return effective[0] ? `${redact(first)} ${redact(effective[0])}` : redact(first)
}

export function normalizeCommandPrefix(command: string): string {
  const segments = splitCommand(command)
  let index = 0
  while (index < segments.length - 1 && stripAssignments(segments[index]!)[0] === 'cd') index++
  return normalizeSegment(stripAssignments(segments[index] ?? []))
}
