function addOptionValue(
  options: GhOptions,
  key: Exclude<keyof GhOptions, 'draft'>,
  value: string | undefined,
): boolean {
  if (value === undefined) {
    return false
  }

  options[key].push(value)
  return true
}

export function attachedShortOptionValue(token: string, flag: string): string | null {
  if (token.startsWith(`${flag}=`)) {
    return token.slice(flag.length + 1)
  }

  if (token.startsWith(flag) && token.length > flag.length) {
    return token.slice(flag.length)
  }

  return null
}

export function optionValueFromLongToken(token: string, option: string): string | null {
  if (!token.startsWith(`${option}=`)) {
    return null
  }

  return token.slice(option.length + 1)
}

export function isGhCommandSeparator(token: string): boolean {
  return (
    token === '&&' ||
    token === '&' ||
    token === '(' ||
    token === ')' ||
    token === ';' ||
    token === '|' ||
    token === '||' ||
    token === '\n'
  )
}
export type GhOptions = {
  body: string[]
  bodyFile: string[]
  draft: boolean
  label: string[]
  repo: string[]
  title: string[]
}

type OptionKey = Exclude<keyof GhOptions, 'draft'>
const OPTION_SPECS: readonly (readonly [OptionKey, string, string])[] = [
  ['body', '--body', '-b'],
  ['bodyFile', '--body-file', '-F'],
  ['label', '--label', '-l'],
  ['repo', '--repo', '-R'],
  ['title', '--title', '-t'],
]

// Records the value for the first spec `token` names and returns how many tokens it consumed
// (2 for a separate value, 1 for an attached one, 0 when no spec matches).
function consumeOption(options: GhOptions, token: string, next: string | undefined): number {
  // A separator ends the command, so it is never an option's value.
  const nextToken = next !== undefined && isGhCommandSeparator(next) ? undefined : next
  for (const [key, long, short] of OPTION_SPECS) {
    if ((token === long || token === short) && addOptionValue(options, key, nextToken)) return 2
    const attached = optionValueFromLongToken(token, long) ?? attachedShortOptionValue(token, short)
    if (addOptionValue(options, key, attached ?? undefined)) return 1
  }
  return 0
}

export function parseGhOptions(tokens: string[]): GhOptions {
  const options: GhOptions = {
    body: [],
    bodyFile: [],
    draft: false,
    label: [],
    repo: [],
    title: [],
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (isGhCommandSeparator(token)) break
    if (token === '--draft') options.draft = true
    else index += Math.max(consumeOption(options, token, tokens[index + 1]) - 1, 0)
  }

  return options
}
