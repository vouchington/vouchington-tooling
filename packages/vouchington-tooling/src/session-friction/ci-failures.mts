import type { FrictionLogReadResult, JournalEntry } from './types.mts'

const GROUP_HEADER = /^- `(recurring|one-off)` — `GitHub Actions` — .*[^\s]$/
const EVIDENCE = /^ {2}- Evidence: .*[^\s]$/
const ROOT_DIAGNOSTIC = /^ {2}- Root diagnostic: .*[^\s]$/
const DISPOSITION = /^ {2}- Disposition: .*[^\s]$/
const BLANK = /^\s*$/

const CI_FAILURES_HEADER = '## CI Failures'

function matchBlock(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let index = 0
  const consume = (pattern: RegExp): string | null => {
    while (index < lines.length && BLANK.test(lines[index]!)) index++
    const line = lines[index]
    if (line === undefined || !pattern.test(line)) return null
    index++
    return line
  }
  const fields = [
    consume(GROUP_HEADER),
    consume(EVIDENCE),
    consume(ROOT_DIAGNOSTIC),
    consume(DISPOSITION),
  ]
  if (fields.some((field) => field === null)) return null
  if (!lines.slice(index).every((line) => BLANK.test(line))) return null
  return fields.join('\n')
}

export function isConformingCiFailureBlock(markdown: string): boolean {
  return matchBlock(markdown) !== null
}

function journalMarkdown(entries: Iterable<JournalEntry>): string[] {
  return [...entries]
    .filter((entry) => entry.data?.type === 'journal')
    .map((entry) => (typeof entry.data?.markdown === 'string' ? entry.data.markdown : ''))
}

export function getConformingGroups(entries: Iterable<JournalEntry>): string[] {
  return journalMarkdown(entries)
    .map(matchBlock)
    .filter((block): block is string => block !== null)
}

export function buildCiFailuresSection(
  sessionId: string,
  journal:
    | { status: 'ok'; markdownBlocks: string[] }
    | { status: 'unreachable'; diagnostic: string },
  frictionStatus: FrictionLogReadResult['status'],
): string {
  if (journal.status === 'unreachable')
    return `${CI_FAILURES_HEADER}\nStatus: unavailable (blackboard unreachable)`
  if (journal.markdownBlocks.length === 0 && frictionStatus === 'absent')
    return `${CI_FAILURES_HEADER}\nStatus: unavailable (no friction log for session ${sessionId})`
  if (journal.markdownBlocks.length === 0) return `${CI_FAILURES_HEADER}\nStatus: none observed`
  return `${CI_FAILURES_HEADER}\nStatus: failures observed\n\n${journal.markdownBlocks.join('\n\n')}`
}
