export function readParenthesizedSubstitution(
  command: string,
  startIndex: number,
): { command: string; endIndex: number } | null {
  let depth = 1
  let quote: "'" | '"' | null = null
  let escaping = false

  for (let index = startIndex; index < command.length; index += 1) {
    const char = command[index]
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
    if (quote === null && char === '(') {
      depth += 1
      continue
    }
    if (quote === null && char === ')' && --depth === 0) {
      return { command: command.slice(startIndex, index), endIndex: index }
    }
  }

  return null
}
export function readBacktickSubstitution(
  command: string,
  startIndex: number,
): { command: string; endIndex: number } | null {
  let value = ''
  let escaping = false
  for (let index = startIndex; index < command.length; index += 1) {
    const char = command[index]
    if (escaping) {
      value += char === '`' || char === '\\' || char === '$' ? char : `\\${char}`
      escaping = false
      continue
    }
    if (char === '\\') {
      escaping = true
      continue
    }
    if (char === '`') {
      return { command: value, endIndex: index }
    }
    value += char
  }

  return null
}
