export const SHELL_REDIRECTION_OPERATORS = [
  '&>>',
  '<<<',
  '<<-',
  '&>',
  '>>',
  '>&',
  '>|',
  '<<',
  '<&',
  '<>',
  '>',
  '<',
] as const

export function shellRedirectionOperatorAt(command: string, index: number): string | null {
  const suffix = command.slice(index)
  return SHELL_REDIRECTION_OPERATORS.find((operator) => suffix.startsWith(operator)) ?? null
}

// A file descriptor written right before an operator: a number (`2>`) or a bash/zsh `{name}` that
// the shell assigns a free descriptor to (`{fd}>out`).
const REDIRECTION_FD = String.raw`(?:\d+|\{[A-Za-z_][A-Za-z0-9_]*\})`
const REDIRECTION_FD_PREFIX = new RegExp(`^${REDIRECTION_FD}`)
const REDIRECTION_FD_WORD = new RegExp(`^${REDIRECTION_FD}$`)

export function isRedirectionFd(word: string): boolean {
  return REDIRECTION_FD_WORD.test(word)
}

// tokenizeShellWords({splitRedirections:true}) fuses a leading file descriptor into the operator
// token itself (e.g. `2>` for `gh pr merge 123 2> --auto`) — strip it before matching.
export function redirectionOperatorOf(token: string): string {
  return token.replace(REDIRECTION_FD_PREFIX, '')
}

export function isShellRedirectionOperatorToken(token: string): boolean {
  return (SHELL_REDIRECTION_OPERATORS as readonly string[]).includes(redirectionOperatorOf(token))
}
