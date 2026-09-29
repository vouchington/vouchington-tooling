import type { JournalEntry } from './types.mts'
import { isWellFormedUnicode, markdownAuditText } from './text.mts'

const BLANK = /^\s*$/

function sanitizeField(line: string, prefixes: readonly string[]): string | null {
  const prefix = prefixes.find((value) => line.startsWith(value))
  /* v8 ignore next -- callers only pass lines that matched a pattern with a known prefix. */
  if (!prefix) return markdownAuditText(line) || null
  const content = markdownAuditText(line.slice(prefix.length))
  return content ? `${prefix}${content}` : null
}

// Consumes exactly one line per pattern (skipping blank lines between them) and nothing else.
function matchLines(markdown: string, patterns: readonly RegExp[]): string[] | null {
  if (!isWellFormedUnicode(markdown)) return null
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let index = 0
  const fields: string[] = []
  for (const pattern of patterns) {
    while (index < lines.length && BLANK.test(lines[index]!)) index++
    const line = lines[index]
    if (line === undefined || !pattern.test(line)) return null
    fields.push(line)
    index++
  }
  return lines.slice(index).every((line) => BLANK.test(line)) ? fields : null
}

/** Returns the paste-safe block, or null when the markdown is not exactly one conforming block. */
export function matchAuditBlock(
  markdown: string,
  patterns: readonly RegExp[],
  prefixes: readonly string[],
): string | null {
  const fields = matchLines(markdown, patterns)
  if (!fields) return null
  const safeFields = fields.map((field) => sanitizeField(field, prefixes))
  return safeFields.some((field) => field === null) ? null : safeFields.join('\n')
}

export function conformingBlocks(
  entries: Iterable<JournalEntry>,
  match: (markdown: string) => string | null,
): string[] {
  return [...entries]
    .flatMap((entry) => {
      const data = (entry as JournalEntry | null)?.data
      return data?.type === 'journal' && typeof data.markdown === 'string' ? [data.markdown] : []
    })
    .map(match)
    .filter((block): block is string => block !== null)
}
