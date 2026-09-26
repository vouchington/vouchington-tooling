import { readDollarQuoteDelimiter, stringLiteralQuoteStart } from './literals.mts'

export {
  dollarQuoteEnd,
  maskSqlQuotedText,
  readDollarQuoteDelimiter,
  readStringLiteral,
  sqlFragments,
} from './literals.mts'
export { stripSqlComments } from './comments.mts'

export function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

export function splitSqlStatements(content: string): { text: string; index: number }[] {
  const statements: { text: string; index: number }[] = []
  let currentStmt = ''
  let stmtStart = 0
  let inSingleQuote = false
  let inEscapeString = false
  let dollarQuoteDelimiter: string | null = null

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]

    if (dollarQuoteDelimiter) {
      if (content.startsWith(dollarQuoteDelimiter, i)) {
        currentStmt += dollarQuoteDelimiter
        i += dollarQuoteDelimiter.length - 1
        dollarQuoteDelimiter = null
      } else {
        currentStmt += ch
      }
      continue
    }

    if (inSingleQuote) {
      currentStmt += ch
      if (inEscapeString && ch === '\\' && i + 1 < content.length) {
        currentStmt += content[i + 1]
        i++
        continue
      }
      if (ch === "'") {
        if (content[i + 1] === "'") {
          currentStmt += content[i + 1]
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
      currentStmt += dollarQuote
      i += dollarQuote.length - 1
      continue
    }

    const stringStart = stringLiteralQuoteStart(content, i)
    if (stringStart) {
      inSingleQuote = true
      inEscapeString = stringStart.escapeString
      currentStmt += content.slice(i, stringStart.quoteStart + 1)
      i = stringStart.quoteStart
    } else if (ch === ';') {
      statements.push({ text: currentStmt, index: stmtStart })
      currentStmt = ''
      stmtStart = i + 1
    } else {
      currentStmt += ch
    }
  }

  if (currentStmt.trim()) {
    statements.push({ text: currentStmt, index: stmtStart })
  }

  return statements
}
