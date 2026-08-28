const MAX_COMMAND_TOKEN_LENGTH = 40
const MAX_COMMAND_LENGTH = 100_000
const REDACTED_TOKEN = '[REDACTED]'
const CREDENTIAL_OPTION = /^--?(?:api[-_]?key|auth|credential|password|secret|token)=/i
const URL_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const PACKAGE_RUNNERS = new Set(['npm', 'npx', 'pnpm', 'pnpx', 'yarn'])
const GIT_OPTIONS_WITH_ARGS = new Set(['-C', '-c'])
const ENV_OPTIONS_WITH_ARGS = new Set(['-C', '--chdir', '-S', '--split-string', '-u', '--unset'])
const ENV_OPTIONS_WITHOUT_ARGS = new Set([
  '-i',
  '--ignore-environment',
  '-0',
  '--null',
  '-v',
  '--debug',
])
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
    else if (';&|<>\n\r'.includes(char)) flushSegment()
    else if (/\s/.test(char)) flushWord()
    else word += char
  }
  if (escaped) word += '\\'
  flushSegment()
  return result
}

function redact(token: string): string {
  return token.length > MAX_COMMAND_TOKEN_LENGTH ||
    CREDENTIAL_OPTION.test(token) ||
    URL_USERINFO.test(token)
    ? REDACTED_TOKEN
    : token
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
    const optionName = option.split('=', 1)[0]!
    const abbreviatedArgument =
      optionName.length >= 5 &&
      ['--chdir', '--split-string'].some((value) => value.startsWith(optionName))
    if (ENV_OPTIONS_WITH_ARGS.has(optionName) || abbreviatedArgument) {
      index += option.includes('=') ? 1 : 2
      continue
    }
    if (ENV_OPTIONS_WITHOUT_ARGS.has(option)) {
      index++
      continue
    }
    if (option.startsWith('-')) return [REDACTED_TOKEN]
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
  if (packageRunner(first) && (rest[0] === 'run' || rest[0] === 'exec') && rest[1])
    return `${redact(first)} ${rest[0]} ${redact(rest[1])}`
  const effective = first === 'git' ? stripGitOptions(rest) : rest
  return effective[0] ? `${redact(first)} ${redact(effective[0])}` : redact(first)
}

export function normalizeCommandPrefix(command: string, wrappersToStrip: string[] = []): string {
  if (command.length > MAX_COMMAND_LENGTH) return REDACTED_TOKEN
  const segments = splitCommand(command)
  let index = 0
  while (index < segments.length - 1 && stripAssignments(segments[index]!)[0] === 'cd') index++
  const tokens = stripAssignments(segments[index] ?? [])
  const wrapperNames = new Set(wrappersToStrip.filter(Boolean))
  let wrappers = 0
  while (tokens[wrappers] && wrapperNames.has(tokens[wrappers]!)) wrappers++
  if (!wrappers) return normalizeSegment(tokens)
  const nested = normalizeSegment(stripAssignments(tokens.slice(wrappers)))
  return nested ? `${redact(tokens[0]!)} ${nested}` : redact(tokens[0]!)
}
