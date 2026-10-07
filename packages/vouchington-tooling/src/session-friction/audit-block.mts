import type { JournalEntry } from './types.mts'
import { fitFields, type AuditRender } from './audit-fit.mts'
import { isWellFormedUnicode, markdownAuditUnits, type AuditRedactor } from './text.mts'

const BLANK = /^\s*$/
// Total escaped bytes one report section may add, so the composed retrospective stays well under
// its 12,000-byte limit; each block gets an equal share once the blocks together exceed it.
const MIN_BLOCK_BYTES = 400

function parseField(
  line: string,
  prefixes: readonly string[],
  redact?: AuditRedactor,
): { prefix: string; units: string[] } | null {
  const prefix = prefixes.find((value) => line.startsWith(value))
  /* v8 ignore next -- callers only pass lines that matched a pattern with a known prefix. */
  if (!prefix) return null
  const units = markdownAuditUnits(line.slice(prefix.length), redact)
  return units.length ? { prefix, units } : null
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
  render: AuditRender = {},
): string | null {
  const fields = matchLines(markdown, patterns)
  if (!fields) return null
  const parsed = fields.map((field) => parseField(field, prefixes, render.redact))
  const safe = parsed.filter((field) => field !== null)
  if (safe.length !== parsed.length) return null
  const overhead = safe.reduce(
    (sum, { prefix }) => sum + Buffer.byteLength(prefix),
    safe.length - 1,
  )
  const contents = fitFields(
    safe.map(({ units }) => units),
    overhead,
    render.budgetBytes ?? Infinity,
  )
  return safe.map(({ prefix }, index) => `${prefix}${contents[index]}`).join('\n')
}

/**
 * Matches every journal block whole; when together they exceed `totalBudgetBytes`, re-renders each
 * within an equal share (never below a minimum) so the section cannot overflow the report limit.
 */
export function conformingBlocks(
  entries: Iterable<JournalEntry>,
  match: (markdown: string, render: AuditRender) => string | null,
  totalBudgetBytes: number,
  redact?: AuditRedactor,
): string[] {
  const markdowns = [...entries].flatMap((entry) => {
    const data = (entry as JournalEntry | null)?.data
    return data?.type === 'journal' && typeof data.markdown === 'string' ? [data.markdown] : []
  })
  const render = (budgetBytes: number): string[] =>
    markdowns
      .map((markdown) => match(markdown, { redact, budgetBytes }))
      .filter((block): block is string => block !== null)
  const blocks = render(Infinity)
  if (Buffer.byteLength(blocks.join('\n\n')) <= totalBudgetBytes) return blocks
  return render(Math.max(MIN_BLOCK_BYTES, Math.floor(totalBudgetBytes / blocks.length)))
}
