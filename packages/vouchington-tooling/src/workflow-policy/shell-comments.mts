/**
 * Strips shell comments whose `#` starts a line or follows whitespace — so a commented-out
 * `exit 1` can never satisfy the readiness proximity check, whether it sits alone or trails real
 * code. Preserves the character positions of everything else. Tracks single/double quote state so
 * a `#` inside a quoted string is never treated as a comment start.
 */
export function stripShellComments(run: string): string {
  return run
    .split('\n')
    .map((line) => {
      let inSingleQuote = false
      let inDoubleQuote = false
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index]
        if (char === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote
        else if (char === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote
        else if (char === '#' && !inSingleQuote && !inDoubleQuote) {
          const previousChar = line[index - 1]
          if (index === 0 || /\s/.test(previousChar!)) return line.slice(0, index)
        }
      }
      return line
    })
    .join('\n')
}
