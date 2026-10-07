import type { JournalEntry } from './types.mts'
import { byteLength, fitFields, selectWithin, type AuditRender } from './audit-fit.mts'
import { isWellFormedUnicode, markdownAuditUnits, type AuditRedactor } from './text.mts'

const BLANK = /^\s*$/
// Below this a block would keep little beyond its field names, so it is omitted (and counted)
// instead. This only ever drops groups; it never lets the section exceed its budget.
const MIN_BLOCK_SHARE_BYTES = 300

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
  render: AuditRender & { shrinkOrder: readonly number[] },
): string | null {
  const fields = matchLines(markdown, patterns)
  if (!fields) return null
  const parsed = fields.map((field) => parseField(field, prefixes, render.redact))
  const safe = parsed.filter((field) => field !== null)
  if (safe.length !== parsed.length) return null
  const overhead = safe.reduce((sum, { prefix }) => sum + byteLength(prefix), safe.length - 1)
  const contents = fitFields(
    safe.map(({ units }) => units),
    overhead,
    render.budgetBytes ?? Infinity,
    render.shrinkOrder,
  )
  return safe.map(({ prefix }, index) => `${prefix}${contents[index]}`).join('\n')
}

/**
 * Matches every journal block whole while together they fit `totalBudgetBytes`. Otherwise it keeps
 * the leading blocks that fit an equal share of the total and appends `omission(count)` — itself a
 * conforming block — so dropped groups are always reported, never silent.
 */
export function conformingBlocks(
  entries: Iterable<JournalEntry>,
  match: (markdown: string, render: AuditRender) => string | null,
  totalBudgetBytes: number,
  redact: AuditRedactor | undefined,
  omission: (count: number) => string,
): string[] {
  const markdowns = [...entries]
    .flatMap((entry) => {
      const data = (entry as JournalEntry | null)?.data
      return data?.type === 'journal' && typeof data.markdown === 'string' ? [data.markdown] : []
    })
    .filter((markdown) => match(markdown, { redact }) !== null)
  const { rendered, omitted } = selectWithin(
    markdowns,
    totalBudgetBytes,
    byteLength(omission(markdowns.length)) + 2,
    2,
    MIN_BLOCK_SHARE_BYTES,
    (markdown, budgetBytes) => match(markdown, { redact, budgetBytes })!,
  )
  return omitted ? [...rendered, omission(omitted)] : rendered
}
