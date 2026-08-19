export type SqlStringLiteralStart = {
  quoteStart: number
  escapeString: boolean
}

export function readDollarQuoteDelimiter(content: string, index: number): string | null {
  if (content[index] !== '$') return null
  /* v8 ignore next */
  if (/[A-Za-z0-9_$]/.test(content[index - 1] ?? '')) return null

  const dollarQuoteRe = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y
  dollarQuoteRe.lastIndex = index
  const match = dollarQuoteRe.exec(content)
  /* v8 ignore next */
  return match?.[0] ?? null
}

function isEscapeStringStart(content: string, index: number): boolean {
  /* v8 ignore next */
  return /[Ee]/.test(content[index] ?? '') && content[index + 1] === "'"
}

export function stringLiteralQuoteStart(
  content: string,
  index: number,
): SqlStringLiteralStart | null {
  if (isEscapeStringStart(content, index)) return { quoteStart: index + 1, escapeString: true }
  if (
    /[Uu]/.test(content[index] ?? '') &&
    content[index + 1] === '&' &&
    content[index + 2] === "'"
  ) {
    return { quoteStart: index + 2, escapeString: false }
  }
  if (content[index] === "'") return { quoteStart: index, escapeString: false }
  return null
}

function singleQuoteEnd(content: string, start: number, escapeString: boolean): number {
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

function decodeSqlStringBody(content: string, escapeString: boolean): string {
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

export function maskSqlQuotedText(content: string): string {
  let masked = ''
  let inSingleQuote = false
  let inEscapeString = false
  let dollarQuoteDelimiter: string | null = null

  for (let i = 0; i < content.length; i++) {
    if (dollarQuoteDelimiter) {
      if (content.startsWith(dollarQuoteDelimiter, i)) {
        masked += ' '.repeat(dollarQuoteDelimiter.length)
        i += dollarQuoteDelimiter.length - 1
        dollarQuoteDelimiter = null
      } else {
        masked += content[i] === '\n' ? '\n' : ' '
      }
      continue
    }

    if (inSingleQuote) {
      masked += ' '
      if (inEscapeString && content[i] === '\\' && i + 1 < content.length) {
        masked += ' '
        i++
        continue
      }
      if (content[i] === "'") {
        if (content[i + 1] === "'") {
          masked += ' '
          i++
        } else {
          inSingleQuote = false
          inEscapeString = false
        }
      }
      continue
    }

    const dollarQuote = readDollarQuoteDelimiter(content, i)
    if (dollarQuote) {
      dollarQuoteDelimiter = dollarQuote
      masked += ' '.repeat(dollarQuote.length)
      i += dollarQuote.length - 1
      continue
    }

    const stringStart = stringLiteralQuoteStart(content, i)
    if (stringStart) {
      inSingleQuote = true
      inEscapeString = stringStart.escapeString
      masked += ' '.repeat(stringStart.quoteStart - i + 1)
      i = stringStart.quoteStart
    } else {
      masked += content[i]
    }
  }

  return masked
}

export function readStringLiteral(
  content: string,
  index: number,
): { text: string; index: number; end: number } | null {
  const start = stringLiteralQuoteStart(content, index)
  if (!start) return null
  const bodyEnd = singleQuoteEnd(content, start.quoteStart, start.escapeString)
  return {
    text: decodeSqlStringBody(content.slice(start.quoteStart + 1, bodyEnd), start.escapeString),
    index: start.quoteStart + 1,
    end: bodyEnd + 1,
  }
}

export function dollarQuoteEnd(content: string, start: number, delimiter: string): number {
  for (let i = start; i < content.length; i++) {
    if (content.startsWith(delimiter, i)) return i
  }
  return -1
}

export function sqlFragments(content: string): { text: string; index: number }[] {
  const fragments: { text: string; index: number }[] = []
  for (let i = 0; i < content.length; i++) {
    const dollarQuote = readDollarQuoteDelimiter(content, i)
    if (dollarQuote) {
      const bodyStart = i + dollarQuote.length
      const bodyEnd = dollarQuoteEnd(content, bodyStart, dollarQuote)
      if (bodyEnd === -1) break
      fragments.push({ text: content.slice(bodyStart, bodyEnd), index: bodyStart })
      i = bodyEnd + dollarQuote.length - 1
      continue
    }

    const literal = readStringLiteral(content, i)
    if (literal) {
      fragments.push({ text: literal.text, index: literal.index })
      i = literal.end - 1
    }
  }
  return fragments
}
