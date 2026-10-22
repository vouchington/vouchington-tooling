import { tokenizeShellWordsDetailed } from './shell-tokenizer.mts'

/**
 * Splits a command into segments on unquoted `;`, `&`, `&&`, `|`, `||`, and newlines, each segment
 * being its already-unquoted words. Parentheses stay inside words (`$(git status)` is one word
 * run, not a nested command), so only top-level command position is exposed.
 */
export function splitCommandSegments(command: string): string[][] {
  const segments: string[][] = []
  let current: string[] = []
  for (const word of tokenizeShellWordsDetailed(command, {
    keepParentheses: true,
    markOperators: true,
  })) {
    if (word.operator === true) {
      if (current.length > 0) segments.push(current)
      current = []
    } else {
      current.push(word.value)
    }
  }
  if (current.length > 0) segments.push(current)
  return segments
}
