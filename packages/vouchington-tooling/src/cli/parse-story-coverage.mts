export type ParsedStoryCoverage = {
  kind: 'story-coverage'
  root: string
  componentRoot: string
  storyRoot: string
  aliases: Record<string, string>
  sourceExtensions: string[]
  componentExtensions: string[]
  marker: string
  storyPattern: string
  exclusionsFile?: string
  exclusionsLabel?: string
}

const FLAGS = new Set([
  '--root',
  '--component-root',
  '--story-root',
  '--alias',
  '--source-extension',
  '--component-extension',
  '--marker',
  '--story-pattern',
  '--exclusions',
  '--exclusions-label',
])

export function parseStoryCoverage(
  args: readonly string[],
): ParsedStoryCoverage | { kind: 'help' } | { kind: 'error'; message: string } {
  if (args.length === 0) return { kind: 'error', message: 'story-coverage requires --root' }
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' }
  const parsed = emptyParsed()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index] ?? ''
    if (!FLAGS.has(flag))
      return { kind: 'error', message: `unknown story-coverage option: ${flag}` }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) {
      return { kind: 'error', message: `${flag} requires a value` }
    }
    index += 1
    const invalid = applyFlag(parsed, flag, value)
    if (invalid) return { kind: 'error', message: invalid }
  }
  return missingField(parsed) ?? parsed
}

function emptyParsed(): ParsedStoryCoverage {
  return {
    kind: 'story-coverage',
    root: '',
    componentRoot: '',
    storyRoot: '',
    aliases: {},
    sourceExtensions: [],
    componentExtensions: [],
    marker: '',
    storyPattern: '',
  }
}

function applyFlag(parsed: ParsedStoryCoverage, flag: string, value: string): string | undefined {
  if (value === '') return `${flag} requires a value`
  if (flag === '--root') parsed.root = value
  else if (flag === '--component-root') parsed.componentRoot = value
  else if (flag === '--story-root') parsed.storyRoot = value
  else if (flag === '--alias') return applyAlias(parsed, value)
  else if (flag === '--source-extension') parsed.sourceExtensions.push(value)
  else if (flag === '--component-extension') parsed.componentExtensions.push(value)
  else if (flag === '--marker') parsed.marker = value
  else if (flag === '--story-pattern') parsed.storyPattern = value
  else if (flag === '--exclusions') parsed.exclusionsFile = value
  else parsed.exclusionsLabel = value
  return undefined
}

function applyAlias(parsed: ParsedStoryCoverage, value: string): string | undefined {
  const split = value.indexOf('=')
  if (split <= 0 || split === value.length - 1) return '--alias must be <prefix>=<path>'
  parsed.aliases[value.slice(0, split)] = value.slice(split + 1)
  return undefined
}

function missingField(parsed: ParsedStoryCoverage): { kind: 'error'; message: string } | undefined {
  if (!parsed.root) return { kind: 'error', message: 'story-coverage requires --root' }
  if (!parsed.componentRoot) {
    return { kind: 'error', message: 'story-coverage requires --component-root' }
  }
  if (!parsed.storyRoot) return { kind: 'error', message: 'story-coverage requires --story-root' }
  if (parsed.sourceExtensions.length === 0) {
    return { kind: 'error', message: 'story-coverage requires --source-extension' }
  }
  if (parsed.componentExtensions.length === 0) {
    return { kind: 'error', message: 'story-coverage requires --component-extension' }
  }
  if (!parsed.marker) return { kind: 'error', message: 'story-coverage requires --marker' }
  if (!parsed.storyPattern)
    return { kind: 'error', message: 'story-coverage requires --story-pattern' }
  return undefined
}
