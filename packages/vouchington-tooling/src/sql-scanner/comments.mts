import { readDollarQuoteDelimiter, stringLiteralQuoteStart } from './literals.mts'

function maskNonNewlines(value: string): string {
  return value.replace(/[^\n]/g, ' ')
}

function lineCommentEnd(content: string, start: number): number {
  let end = start
  while (end < content.length && content[end] !== '\n') end++
  return end
}

function blockCommentEnd(content: string, start: number): number {
  let depth = 1
  let end = start + 2
  while (end < content.length) {
    if (content[end] === '/' && content[end + 1] === '*') {
      depth++
      end += 2
    } else if (content[end] === '*' && content[end + 1] === '/') {
      depth--
      if (depth === 0) return end + 2
      end += 2
    } else {
      end++
    }
  }
  return content.length
}

export function stripSqlComments(content: string): string {
  let stripped = ''
  let inSingleQuote = false
  let inEscapeString = false
  let dollarQuoteDelimiter: string | null = null

  for (let i = 0; i < content.length; i++) {
    if (dollarQuoteDelimiter) {
      if (content.startsWith(dollarQuoteDelimiter, i)) {
        stripped += dollarQuoteDelimiter
        i += dollarQuoteDelimiter.length - 1
        dollarQuoteDelimiter = null
      } else {
        stripped += content[i]
      }
      continue
    }

    if (inSingleQuote) {
      stripped += content[i]
      if (inEscapeString && content[i] === '\\' && i + 1 < content.length) {
        stripped += content[i + 1]
        i++
        continue
      }
      if (content[i] === "'") {
        if (content[i + 1] === "'") {
          stripped += content[i + 1]
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
      stripped += dollarQuote
      i += dollarQuote.length - 1
      continue
    }

    const stringStart = stringLiteralQuoteStart(content, i)
    if (stringStart) {
      inSingleQuote = true
      inEscapeString = stringStart.escapeString
      stripped += content.slice(i, stringStart.quoteStart + 1)
      i = stringStart.quoteStart
      continue
    }

    if (content[i] === '-' && content[i + 1] === '-') {
      const end = lineCommentEnd(content, i)
      if (end === content.length) {
        stripped += ' '.repeat(content.length - i)
        break
      }
      stripped += `${' '.repeat(end - i)}\n`
      i = end
      continue
    }

    if (content[i] === '/' && content[i + 1] === '*') {
      const end = blockCommentEnd(content, i)
      stripped += maskNonNewlines(content.slice(i, end))
      i = end - 1
      continue
    }

    stripped += content[i]
  }

  return stripped
}
