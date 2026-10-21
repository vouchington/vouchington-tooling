// `NAME=value`, `NAME+=value`, and `NAME[SUB]=value`. Only the plain form gives the command a value
// the hook can read: `+=` appends to a value it cannot see, and an array element is never exported.
const SHELL_ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?(\+)?=/
const SHELL_COMMAND_SEPARATORS = new Set(['&&', '&', '(', ')', ';', '|', '||', '\n', '{', '}'])

export function commandSegmentStart(
  tokens: string[],
  index: number,
  isSeparator = isShellCommandSeparator,
): number {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (isSeparator(tokens[cursor]!)) {
      return cursor + 1
    }
  }

  return 0
}

export function isShellAssignment(token: string): boolean {
  return SHELL_ASSIGNMENT_RE.test(token)
}

/** The variable a plain `NAME=value` assignment sets, or null for any other word. */
export function plainShellAssignment(token: string): { name: string; value: string } | null {
  const match = SHELL_ASSIGNMENT_RE.exec(token)
  if (match === null || match[2] !== undefined || match[3] !== undefined) return null
  return { name: match[1]!, value: token.slice(match[0].length) }
}

export function isShellCommandSeparator(token: string): boolean {
  return SHELL_COMMAND_SEPARATORS.has(token)
}

export function nextShellCommandSeparatorIndex(tokens: string[], startIndex: number): number {
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (isShellCommandSeparator(tokens[index]!)) {
      return index
    }
  }

  return tokens.length
}
