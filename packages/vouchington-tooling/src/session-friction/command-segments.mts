export const REDACTED_TOKEN = '[REDACTED]'
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const ENV_OPTIONS_WITH_ARGS = new Set(['-C', '--chdir', '-S', '--split-string', '-u', '--unset'])
const ENV_OPTIONS_WITHOUT_ARGS = new Set([
  '-i',
  '--ignore-environment',
  '-0',
  '--null',
  '-v',
  '--debug',
])

export function splitCommand(command: string): string[][] {
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

export function stripAssignments(tokens: string[]): string[] {
  let index = 0
  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index]!)) index++
  const wrapper = tokens[index]
  // Assignments without an executable are represented by a safe sentinel.
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
    const splitStringOption =
      optionName === '-S' || (optionName.length >= 5 && '--split-string'.startsWith(optionName))
    if (splitStringOption) return [REDACTED_TOKEN]
    const abbreviatedArgument = optionName.length >= 5 && '--chdir'.startsWith(optionName)
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
  if (index < tokens.length) return tokens.slice(index)
  return tokens.some((token) => ENV_ASSIGNMENT.test(token)) ? [REDACTED_TOKEN] : []
}
