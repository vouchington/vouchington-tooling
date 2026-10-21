import {
  readBacktickSubstitution,
  readParenthesizedSubstitution,
} from './shell-command-substitution-reads.mts'
import { stripUnquotedShellComments } from './shell-tokenizer.mts'

/**
 * The command substitutions a command's text runs. Heredoc bodies follow other quoting rules, so
 * the caller blanks them first and reads their substitutions from the heredoc scan
 * (shell-heredoc.mts).
 */
export function extractShellCommandSubstitutions(textWithoutBodies: string): string[] {
  const source = stripUnquotedShellComments(textWithoutBodies)
  const substitutions: string[] = []
  let quote: "'" | '"' | null = null
  let escaping = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (escaping) {
      escaping = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaping = true
      continue
    }
    if (char === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'"
      continue
    }
    if (char === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"'
      continue
    }
    if (quote === "'") {
      continue
    }
    if (char === '$' && source[index + 1] === '(') {
      const substitution = readParenthesizedSubstitution(source, index + 2)
      if (substitution !== null) {
        substitutions.push(substitution.command)
        index = substitution.endIndex
      }
      continue
    }
    if (char === '`') {
      const substitution = readBacktickSubstitution(source, index + 1)
      if (substitution !== null) {
        substitutions.push(substitution.command)
        index = substitution.endIndex
      }
    }
  }

  return substitutions
}

export { readBacktickSubstitution, readParenthesizedSubstitution }
