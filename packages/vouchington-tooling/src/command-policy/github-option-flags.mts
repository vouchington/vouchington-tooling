import { attachedShortOptionValue, optionValueFromLongToken } from './github-options.mts'

const FALSE_FLAG_VALUES = new Set(['false', '0', 'no', 'off'])

function clusteredShortOptionValue(token: string, shortName: string): string | null {
  if (!token.startsWith('-') || token.startsWith('--') || shortName.length !== 1) {
    return null
  }
  const body = token.slice(1)
  const flagIndex = body.indexOf(shortName)
  if (flagIndex === -1) {
    return null
  }
  return body.slice(flagIndex + 1)
}

export function lastNamedOption(
  optionTokens: string[],
  name: string,
  shortFlag?: string,
): string | undefined {
  const flag = `--${name}`
  const short = shortFlag === undefined ? undefined : `-${shortFlag}`
  let value: string | undefined
  for (let index = 0; index < optionTokens.length; index += 1) {
    const token = optionTokens[index]!
    if (token === flag || (short !== undefined && token === short)) {
      const next = optionTokens[index + 1]
      if (next !== undefined && !next.startsWith('-')) {
        value = next
        index += 1
      }
      continue
    }
    const clustered = shortFlag === undefined ? null : clusteredShortOptionValue(token, shortFlag)
    if (clustered !== null) {
      if (clustered !== '') {
        value = clustered
        continue
      }
      const next = optionTokens[index + 1]
      if (next !== undefined && !next.startsWith('-')) {
        value = next
        index += 1
      }
      continue
    }
    const attached =
      optionValueFromLongToken(token, flag) ??
      (short === undefined ? null : attachedShortOptionValue(token, short))
    if (attached !== null) {
      value = attached
    }
  }
  return value
}

export function hasNamedFlag(optionTokens: string[], name: string): boolean {
  const flag = `--${name}`
  let enabled = false
  for (const token of optionTokens) {
    if (token === flag) {
      enabled = true
      continue
    }
    const attached = optionValueFromLongToken(token, flag)
    if (attached !== null) {
      enabled = !FALSE_FLAG_VALUES.has(attached.toLowerCase())
    }
  }
  return enabled
}

export function hasNumericPrSelector(optionTokens: string[]): boolean {
  return optionTokens.some((token) => /^\d+$/.test(token))
}
