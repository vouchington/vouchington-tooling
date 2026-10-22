import { readAnsiCString } from './ansi-c-string.mts'
import { consumeShellSeparator } from './shell-tokenizer-operators.mts'
import { stripUnquotedShellComments } from './shell-tokenizer-comments.mts'

const DOUBLE_QUOTE_ESCAPE_CHARS = new Set(['$', '`', '"', '\\', '\n'])

export type ShellWord = { expandable: boolean; operator?: true; value: string }

export type ShellTokenizeOptions = {
  /** Keep `(` and `)` inside words instead of emitting them as operator tokens. */
  keepParentheses?: boolean
  /** Tag command-separator tokens (`;`, `&`, `&&`, `|`, `||`, `(`, `)`, newline) with `operator`. */
  markOperators?: boolean
  splitRedirections?: boolean
}

export function tokenizeShellWordsDetailed(
  command: string,
  options: ShellTokenizeOptions = {},
): ShellWord[] {
  const commandWithoutComments = stripUnquotedShellComments(command)
  const tokens: ShellWord[] = []
  let token = ''
  let expandable = false
  let quote: "'" | '"' | null = null
  let escaping = false

  function pushToken(): void {
    if (token === '') return
    tokens.push({ expandable, value: token })
    token = ''
    expandable = false
  }

  for (let index = 0; index < commandWithoutComments.length; index += 1) {
    const char = commandWithoutComments[index]!
    if (escaping) {
      if (char === '\n') {
        // Line continuation: bash removes `\<newline>` unquoted and in double quotes.
      } else if (quote === '"' && !DOUBLE_QUOTE_ESCAPE_CHARS.has(char!)) {
        token += `\\${char}`
      } else {
        token += char
      }
      escaping = false
      continue
    }

    if (quote === null && char === '$' && commandWithoutComments[index + 1] === "'") {
      const ansiString = readAnsiCString(commandWithoutComments, index + 2)
      if (ansiString !== null) {
        token += ansiString.value
        index = ansiString.endIndex
        continue
      }
    }

    if (char === '\\') {
      if (quote === "'") {
        token += char
        continue
      }

      escaping = true
      continue
    }

    if (quote !== "'" && (char === '$' || char === '`')) expandable = true

    if (quote !== null) {
      if (char === quote) {
        quote = null
      } else {
        token += char
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      continue
    }

    if (char === '\n') {
      pushToken()
      tokens.push({
        expandable: false,
        value: '\n',
        ...(options.markOperators ? { operator: true } : {}),
      })
      continue
    }

    if (/\s/.test(char)) {
      pushToken()
      continue
    }

    const separator: {
      char: string
      command: string
      expandable: boolean
      index: number
      options: ShellTokenizeOptions
      token: string
      tokens: ShellWord[]
    } = {
      char,
      command: commandWithoutComments,
      expandable,
      index,
      options,
      token,
      tokens,
    }
    const consumedIndex = consumeShellSeparator(separator)
    token = separator.token
    expandable = separator.expandable
    if (consumedIndex !== undefined) {
      index = consumedIndex
      continue
    }

    if (
      quote === null &&
      (char === '*' ||
        char === '?' ||
        char === '[' ||
        (char === '{' && /^\{[^}]*(?:,|\.\.)[^}]*\}/.test(commandWithoutComments.slice(index))))
    )
      expandable = true
    token += char
  }

  pushToken()
  return tokens
}

export function tokenizeShellWords(command: string, options: ShellTokenizeOptions = {}): string[] {
  return tokenizeShellWordsDetailed(command, options).map((token) => token.value)
}

export { stripUnquotedShellComments }
