import { visitRunSteps, type GhaFileKind } from './shared.mts'
const WORKSPACE_RE = /(?:\$\{?GITHUB_WORKSPACE\}?|\$\{\{\s*github\.workspace\s*\}\})/iu
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
export function checkDockerWorkspaceUserDocument(
  file: string,
  document: unknown,
  kind: GhaFileKind,
  errors: string[],
): void {
  visitRunSteps(document, kind === 'action', (scope, index, step) => {
    if (typeof step.run !== 'string') return
    for (const block of dockerRunBlocks(step.run)) {
      const options = dockerOptions(block)
      if (!options) continue
      const writable = options.volumes.filter(
        (volume) => WORKSPACE_RE.test(volume) && !isReadOnlyVolume(volume),
      )
      if (writable.length === 0 || hasHostUserMapping(options.user)) continue
      errors.push(
        `::error file=${file}::${file}: ${scope} step ${index} runs Docker with a writable ` +
          `GITHUB_WORKSPACE mount (${writable.join(', ')}) but no --user host UID:GID mapping. ` +
          'Use --user "$(id -u):$(id -g)" or make the workspace mount read-only.',
      )
    }
  })
}

function shellTokens(input: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote = ''
  let substitutionDepth = 0
  let githubExpression = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!
    if (githubExpression) {
      token += character
      if (character === '}' && input[index + 1] === '}') {
        token += '}'
        index += 1
        githubExpression = false
      }
      continue
    }
    if (substitutionDepth > 0) {
      token += character
      if (character === '(') substitutionDepth += 1
      if (character === ')') substitutionDepth -= 1
      continue
    }
    if (character === '$' && input[index + 1] === '{' && input[index + 2] === '{') {
      token += '${{'
      index += 2
      githubExpression = true
      continue
    }
    if (character === '$' && input[index + 1] === '(') {
      token += '$('
      substitutionDepth = 1
      index += 1
      continue
    }
    if (quote) {
      if (character === '\\' && input[index + 1] !== undefined) token += input[++index]!
      else if (character === quote) quote = ''
      else token += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/u.test(character)) {
      if (token) tokens.push(token)
      token = ''
      continue
    }
    if (character === '#' && !token) break
    if (character === ';' || character === '|' || character === '&') {
      if (token) tokens.push(token)
      token = ''
      if ((character === '&' || character === '|') && input[index + 1] === character) index += 1
      tokens.push(character)
      continue
    }
    if (character === '\\' && input[index + 1] !== undefined) token += input[++index]!
    else token += character
  }
  if (token) tokens.push(token)
  return tokens
}

function dockerRunBlocks(run: string): string[] {
  const blocks: string[] = []
  const lines = run.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bdocker\b/u.test(lines[index]!)) continue
    let block = lines[index]!
    while (block.trimEnd().endsWith('\\') && index + 1 < lines.length) {
      index += 1
      block = `${block.trimEnd().slice(0, -1)} ${lines[index]!}`
    }
    blocks.push(block)
  }
  return blocks
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

function dockerOptions(block: string): { user: string | undefined; volumes: string[] } | undefined {
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

function hasHostUserMapping(value: string | undefined): boolean {
  return value !== undefined && /^\$\(\s*id\s+-u\s*\):\$\(\s*id\s+-g\s*\)$/u.test(value)
}

function isReadOnlyVolume(value: string): boolean {
  return /(?:^|:)ro(?:$|,)/u.test(value) || /(?:^|,)readonly(?:$|,)/u.test(value)
}
