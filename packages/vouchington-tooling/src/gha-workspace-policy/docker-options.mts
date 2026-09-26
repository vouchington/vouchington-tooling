import { shellTokens } from './shell-tokens.mts'

const DOCKER_GLOBAL_FLAG_OPTIONS = new Set(['--debug', '-D', '--help', '--tls', '--tlsverify'])
const DOCKER_GLOBAL_VALUE_OPTIONS = new Set([
  '--config',
  '--context',
  '-c',
  '--host',
  '-H',
  '--log-level',
  '-l',
  '--tlscacert',
  '--tlscert',
  '--tlskey',
])
const FLAG_OPTIONS = new Set([
  '--detach',
  '-d',
  '--init',
  '--interactive',
  '-i',
  '--privileged',
  '--publish-all',
  '-P',
  '--read-only',
  '--rm',
  '--tty',
  '-t',
])

export function dockerOptions(
  block: string,
): { user: string | undefined; volumes: string[] } | undefined {
  const tokens = shellTokens(block)
  const dockerIndex = findDockerCommand(tokens)
  if (dockerIndex < 0) return undefined
  let start = dockerIndex + 1
  while (start < tokens.length && tokens[start]!.startsWith('-')) {
    const option = tokens[start]!
    const name = option.includes('=') ? option.slice(0, option.indexOf('=')) : option
    if (DOCKER_GLOBAL_FLAG_OPTIONS.has(name) || option.includes('=')) start += 1
    else if (DOCKER_GLOBAL_VALUE_OPTIONS.has(name)) start += 2
    else return undefined
  }
  if (tokens[start] === 'container') start += 1
  if (tokens[start] !== 'run') return undefined
  start += 1
  const volumes: string[] = []
  let user: string | undefined
  for (let index = start; index < tokens.length; index += 1) {
    const option = tokens[index]!
    if (!option.startsWith('-')) break
    const equals = option.indexOf('=')
    const compact = option.startsWith('-v') || option.startsWith('-u')
    const name =
      equals > 0
        ? option.slice(0, equals)
        : compact && option.length > 2
          ? option.slice(0, 2)
          : option
    const inlineValue =
      equals > 0
        ? option.slice(equals + 1)
        : compact && option.length > 2
          ? option.slice(2)
          : undefined
    const bundledFlags = /^-[diPt]{2,}$/u.test(option)
    const value =
      inlineValue ?? (FLAG_OPTIONS.has(name) || bundledFlags ? undefined : tokens[++index])
    if ((name === '-v' || name === '--volume' || name === '--mount') && value !== undefined)
      volumes.push(value)
    if ((name === '-u' || name === '--user') && value !== undefined) user = value
  }
  return { user, volumes }
}

function findDockerCommand(tokens: readonly string[]): number {
  let commandStart = true
  for (const [index, token] of tokens.entries()) {
    if (token === ';' || token === '|' || token === '&') {
      commandStart = true
      continue
    }
    if (!commandStart) continue
    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/u.test(token)) continue
    if (token === 'docker') return index
    commandStart = false
  }
  return -1
}
