export function singleQuoteEnd(content: string, start: number, escapeString: boolean): number {
  for (let i = start + 1; i < content.length; i++) {
    if (escapeString && content[i] === '\\') {
      i++
      continue
    }
    if (content[i] !== "'") continue
    if (content[i + 1] === "'") {
      i++
    } else {
      return i
    }
  }
  return content.length
}

export function decodeSqlStringBody(content: string, escapeString: boolean): string {
  let decoded = ''
  for (let i = 0; i < content.length; i++) {
    if (escapeString && content[i] === '\\' && i + 1 < content.length) {
      const escaped = content[i + 1]
      decoded += escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped
      i++
    } else if (content[i] === "'" && content[i + 1] === "'") {
      decoded += "'"
      i++
    } else {
      decoded += content[i]
    }
  }
  return decoded
}
