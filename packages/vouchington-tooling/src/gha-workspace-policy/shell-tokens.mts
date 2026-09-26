import {
  consumeCommandSubstitution,
  consumeGithubExpression,
  consumeQuotedCharacter,
  type ShellTokenScan,
} from './shell-token-modes.mts'

export function shellTokens(input: string): string[] {
  const scan: ShellTokenScan = {
    githubExpression: false,
    quote: '',
    substitutionDepth: 0,
    token: '',
    tokens: [],
  }
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!
    if (scan.githubExpression) {
      index = consumeGithubExpression(input, index, scan)
      continue
    }
    if (scan.substitutionDepth > 0) {
      index = consumeCommandSubstitution(input, index, scan)
      continue
    }
    if (character === '$' && input[index + 1] === '{' && input[index + 2] === '{') {
      scan.token += '${{'
      index += 2
      scan.githubExpression = true
      continue
    }
    if (character === '$' && input[index + 1] === '(') {
      scan.token += '$('
      scan.substitutionDepth = 1
      index += 1
      continue
    }
    if (scan.quote) {
      index = consumeQuotedCharacter(input, index, scan)
      continue
    }
    if (character === '"' || character === "'") {
      scan.quote = character
      continue
    }
    if (/\s/u.test(character)) {
      if (scan.token) scan.tokens.push(scan.token)
      scan.token = ''
      continue
    }
    if (character === '#' && !scan.token) break
    if (character === ';' || character === '|' || character === '&') {
      if (scan.token) scan.tokens.push(scan.token)
      scan.token = ''
      if ((character === '&' || character === '|') && input[index + 1] === character) index += 1
      scan.tokens.push(character)
      continue
    }
    if (character === '\\' && input[index + 1] !== undefined) scan.token += input[++index]!
    else scan.token += character
  }
  if (scan.token) scan.tokens.push(scan.token)
  return scan.tokens
}
