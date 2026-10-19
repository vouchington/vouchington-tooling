import { readAnsiCString } from './ansi-c-string.mts'
import { consumeShellSeparator } from './shell-tokenizer-operators.mts'
import { stripUnquotedShellComments } from './shell-tokenizer-comments.mts'

const DOUBLE_QUOTE_ESCAPE_CHARS = new Set(['$', '`', '"', '\\', '\n'])

export type ShellWord = { expandable: boolean; value: string }

export function tokenizeShellWordsDetailed(
  command: string,
  options: { splitRedirections?: boolean } = {},
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
      if (quote === '"' && !DOUBLE_QUOTE_ESCAPE_CHARS.has(char!)) {
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
      tokens.push({ expandable: false, value: '\n' })
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
      options: { splitRedirections?: boolean }
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

export function tokenizeShellWords(
  command: string,
  options: { splitRedirections?: boolean } = {},
): string[] {
  return tokenizeShellWordsDetailed(command, options).map((token) => token.value)
}

export { stripUnquotedShellComments }
