export type ShellTokenScan = {
  githubExpression: boolean
  quote: string
  substitutionDepth: number
  token: string
  tokens: string[]
}

export function consumeGithubExpression(
  input: string,
  index: number,
  scan: ShellTokenScan,
): number {
  const character = input[index]!
  scan.token += character
  if (character === '}' && input[index + 1] === '}') {
    scan.token += '}'
    scan.githubExpression = false
    return index + 1
  }
  return index
}

export function consumeCommandSubstitution(
  input: string,
  index: number,
  scan: ShellTokenScan,
): number {
  const character = input[index]!
  scan.token += character
  if (character === '(') scan.substitutionDepth += 1
  if (character === ')') scan.substitutionDepth -= 1
  return index
}

export function consumeQuotedCharacter(input: string, index: number, scan: ShellTokenScan): number {
  const character = input[index]!
  if (character === '\\' && input[index + 1] !== undefined) {
    scan.token += input[index + 1]!
    return index + 1
  }
  if (character === scan.quote) scan.quote = ''
  else scan.token += character
  return index
}
