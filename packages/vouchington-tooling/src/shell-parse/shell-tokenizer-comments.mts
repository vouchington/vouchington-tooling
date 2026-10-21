import { readAnsiCString } from './ansi-c-string.mts'

export function stripUnquotedShellComments(command: string): string {
  let result = ''
  let quote: "'" | '"' | null = null
  let escaping = false
  let wordStarted = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (escaping) {
      result += char
      escaping = false
      continue
    }

    if (quote === null && char === '$' && command[index + 1] === "'") {
      const ansiString = readAnsiCString(command, index + 2)
      if (ansiString !== null) {
        result += command.slice(index, ansiString.endIndex + 1)
        wordStarted = true
        index = ansiString.endIndex
        continue
      }
    }

    if (char === '\\' && quote !== "'") {
      result += char
      wordStarted = true
      escaping = true
      continue
    }

    if (quote !== null) {
      result += char
      if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "'" || char === '"') {
      result += char
      quote = char
      wordStarted = true
      continue
    }

    if (char === '#' && !wordStarted) {
      while (index + 1 < command.length && command[index + 1] !== '\n') {
        index += 1
      }
      continue
    }

    result += char
    if (char === '\n' || /\s/.test(char) || /[&|;()]/.test(char)) {
      wordStarted = false
    } else {
      wordStarted = true
    }
  }

  return result
}
