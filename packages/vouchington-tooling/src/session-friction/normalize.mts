import { REDACTED_TOKEN, splitCommand, stripAssignments } from './command-segments.mts'

const MAX_COMMAND_TOKEN_LENGTH = 40
const MAX_COMMAND_LENGTH = 100_000
const MAX_COMMAND_WRAPPERS = 16
const CREDENTIAL_OPTION = /^--?(?:api[-_]?key|auth|credential|password|secret|token)=/i
const URL_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i
const PACKAGE_RUNNERS = new Set(['npm', 'npx', 'pnpm', 'pnpx', 'yarn'])
const GIT_OPTIONS_WITH_ARGS = new Set(['-C', '-c', '--git-dir', '--work-tree'])
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

function redact(token: string): string {
  return token.length > MAX_COMMAND_TOKEN_LENGTH ||
    CREDENTIAL_OPTION.test(token) ||
    URL_USERINFO.test(token)
    ? REDACTED_TOKEN
    : token
}

function stripGitOptions(tokens: string[]): string[] {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]!
    if (token === '--') return tokens.slice(index + 1)
    if (GIT_OPTIONS_WITH_ARGS.has(token)) {
      if (index + 1 >= tokens.length) return [REDACTED_TOKEN]
      index += 2
    } else if (GIT_OPTIONS_WITHOUT_ARGS.has(token) || /^--[a-z0-9-]+=/i.test(token)) index++
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
  const effective = first === 'git' || first.endsWith('/git') ? stripGitOptions(rest) : rest
  return effective[0] ? `${redact(first)} ${redact(effective[0])}` : redact(first)
}

export function normalizeCommandPrefix(command: string, wrappersToStrip: string[] = []): string {
  if (command.length > MAX_COMMAND_LENGTH) return '[REDACTED: command too long]'
  const segments = splitCommand(command)
  let index = 0
  while (index < segments.length - 1 && stripAssignments(segments[index]!)[0] === 'cd') index++
  const tokens = stripAssignments(segments[index] ?? [])
  const wrapperValues = Array.isArray(wrappersToStrip) ? wrappersToStrip : []
  const wrapperNames = new Set(
    wrapperValues
      .slice(0, MAX_COMMAND_WRAPPERS)
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0 && value.length <= MAX_COMMAND_TOKEN_LENGTH,
      ),
  )
  let wrappers = 0
  while (tokens[wrappers] && wrapperNames.has(tokens[wrappers]!)) wrappers++
  if (!wrappers) return normalizeSegment(tokens)
  const nested = normalizeSegment(stripAssignments(tokens.slice(wrappers)))
  return nested ? `${redact(tokens[0]!)} ${nested}` : redact(tokens[0]!)
}
