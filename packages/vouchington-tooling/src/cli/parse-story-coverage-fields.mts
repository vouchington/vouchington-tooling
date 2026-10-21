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

export function emptyParsed(): ParsedStoryCoverage {
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

export function applyFlag(
  parsed: ParsedStoryCoverage,
  flag: string,
  value: string,
): string | undefined {
  if (value === '') return `${flag} requires a value`
  if (flag === '--alias') return applyAlias(parsed, value)
  if (flag === '--source-extension') {
    parsed.sourceExtensions.push(value)
    return undefined
  }
  if (flag === '--component-extension') {
    parsed.componentExtensions.push(value)
    return undefined
  }
  const field = scalarField(flag)
  if (field) parsed[field] = value
  else parsed.exclusionsLabel = value
  return undefined
}

function scalarField(
  flag: string,
):
  | 'root'
  | 'componentRoot'
  | 'storyRoot'
  | 'marker'
  | 'storyPattern'
  | 'exclusionsFile'
  | undefined {
  if (flag === '--root') return 'root'
  if (flag === '--component-root') return 'componentRoot'
  if (flag === '--story-root') return 'storyRoot'
  if (flag === '--marker') return 'marker'
  if (flag === '--story-pattern') return 'storyPattern'
  if (flag === '--exclusions') return 'exclusionsFile'
  return undefined
}

function applyAlias(parsed: ParsedStoryCoverage, value: string): string | undefined {
  const split = value.indexOf('=')
  if (split <= 0 || split === value.length - 1) return '--alias must be <prefix>=<path>'
  parsed.aliases[value.slice(0, split)] = value.slice(split + 1)
  return undefined
}

export function missingField(
  parsed: ParsedStoryCoverage,
): { kind: 'error'; message: string } | undefined {
  const missing = [
    [parsed.root, '--root'],
    [parsed.componentRoot, '--component-root'],
    [parsed.storyRoot, '--story-root'],
    [parsed.sourceExtensions.length > 0 ? 'set' : '', '--source-extension'],
    [parsed.componentExtensions.length > 0 ? 'set' : '', '--component-extension'],
    [parsed.marker, '--marker'],
    [parsed.storyPattern, '--story-pattern'],
  ].find(([value]) => value === '')
  if (!missing) return undefined
  return { kind: 'error', message: `story-coverage requires ${missing[1]}` }
}
