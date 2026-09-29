import type { JournalEntry, JournalLoader } from './types.mts'

const JOURNAL_ENTRY_MAX_COUNT = 500
const JOURNAL_MARKDOWN_MAX_BYTES = 10_000
const JOURNAL_TOTAL_MAX_BYTES = 1_000_000

export type JournalScan =
  | { status: 'ok'; entries: JournalEntry[]; truncated: boolean }
  | { status: 'not-found' }
  | { status: 'unreachable'; diagnostic: string }

function journalData(
  entry: JournalEntry,
): { type: unknown; markdown: unknown } | undefined | 'unreadable' {
  try {
    const data = (entry as JournalEntry | null)?.data
    return data ? { type: data.type, markdown: data.markdown } : undefined
  } catch {
    return 'unreadable'
  }
}

async function collectEntries(
  entries: Iterable<JournalEntry> | AsyncIterable<JournalEntry>,
): Promise<{ entries: JournalEntry[]; truncated: boolean }> {
  const result: JournalEntry[] = []
  let consumed = 0
  let inspectedBytes = 0
  let retainedBytes = 0
  let truncated = false
  for await (const entry of entries) {
    consumed++
    const scanned = journalData(entry)
    if (scanned === 'unreadable') truncated = true
    const data = scanned === 'unreadable' ? undefined : scanned
    const markdown = data?.markdown
    if (data?.type === 'journal' && typeof markdown !== 'string') truncated = true
    if (data?.type === 'journal' && typeof markdown === 'string') {
      const bytes = Buffer.byteLength(markdown)
      inspectedBytes += bytes
      if (bytes > JOURNAL_MARKDOWN_MAX_BYTES) truncated = true
      if (bytes <= JOURNAL_MARKDOWN_MAX_BYTES && retainedBytes + bytes <= JOURNAL_TOTAL_MAX_BYTES) {
        result.push({ data: { type: 'journal', markdown } })
        retainedBytes += bytes
      }
    }
    if (
      consumed >= JOURNAL_ENTRY_MAX_COUNT ||
      inspectedBytes >= JOURNAL_TOTAL_MAX_BYTES ||
      retainedBytes >= JOURNAL_TOTAL_MAX_BYTES
    ) {
      truncated = true
      break
    }
  }
  return { entries: result, truncated }
}

export function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '[unprintable error]'
  }
}

/** Loads the session journal through the caller's loader within the shared bounded scan. */
export async function scanJournal(sessionId: string, loader: JournalLoader): Promise<JournalScan> {
  try {
    const loaded = await loader(sessionId)
    if (loaded.status === 'not-found') return { status: 'not-found' }
    return { status: 'ok', ...(await collectEntries(loaded.entries)) }
  } catch (error) {
    return { status: 'unreachable', diagnostic: errorMessage(error) }
  }
}
