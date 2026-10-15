import type { JournalEntry } from './types.mts'
import { conformingBlocks, matchAuditBlock } from './audit-block.mts'
import type { AuditRender } from './audit-fit.mts'
import type { AuditRedactor } from './text.mts'

const GROUP_HEADER = /^- `(recurring|one-off)` — `GitHub Actions` — .*[^\s]$/
const EVIDENCE = /^ {2}- Evidence: .*[^\s]$/
const ROOT_DIAGNOSTIC = /^ {2}- Root diagnostic: .*[^\s]$/
const DISPOSITION = /^ {2}- Disposition: .*[^\s]$/

const CI_FAILURES_HEADER = '## CI Failures'
const CI_FAILURE_BLOCK_MAX_BYTES = 10_000
const FIELD_PREFIXES = [
  '- `recurring` — `GitHub Actions` — ',
  '- `one-off` — `GitHub Actions` — ',
  '  - Evidence: ',
  '  - Root diagnostic: ',
  '  - Disposition: ',
]

const CI_SECTION_MAX_BYTES = 4_000

// Field order: header, Evidence, Root diagnostic, Disposition. Cut Root diagnostic first and
// Evidence last, so the run URL and commit SHA survive longest.
const SHRINK_ORDER = [2, 3, 0, 1]

function matchBlock(markdown: string, render: AuditRender = {}): string | null {
  return matchAuditBlock(
    markdown,
    [GROUP_HEADER, EVIDENCE, ROOT_DIAGNOSTIC, DISPOSITION],
    FIELD_PREFIXES,
    { ...render, shrinkOrder: SHRINK_ORDER },
  )
}

/** A conforming group that reports dropped groups, so omission is never silent. */
function omissionGroup(count: number): string {
  return [
    `- \`one-off\` — \`GitHub Actions\` — ${count} further failure groups omitted to fit the size limit; see journal`,
    '  - Evidence: omitted groups remain in the session journal',
    '  - Root diagnostic: omitted to fit the retrospective size limit',
    '  - Disposition: see journal for the omitted failure groups',
  ].join('\n')
}

export function isConformingCiFailureBlock(markdown: string): boolean {
  if (
    markdown.length > CI_FAILURE_BLOCK_MAX_BYTES ||
    Buffer.byteLength(markdown) > CI_FAILURE_BLOCK_MAX_BYTES
  )
    return false
  return matchBlock(markdown) !== null
}

export function getConformingGroups(
  entries: Iterable<JournalEntry>,
  redact?: AuditRedactor,
  maxBytes = CI_SECTION_MAX_BYTES,
): string[] {
  return conformingBlocks(
    entries,
    matchBlock,
    Math.min(maxBytes, CI_SECTION_MAX_BYTES),
    redact,
    omissionGroup,
  )
}

export function incompleteCiSection(markdownBlocks: string[]): string {
  return [
    `${CI_FAILURES_HEADER}\nStatus: unavailable (journal scan incomplete)`,
    ...markdownBlocks,
  ].join('\n\n')
}

export function buildCiFailuresSection(markdownBlocks: string[]): string {
  if (markdownBlocks.length === 0) return `${CI_FAILURES_HEADER}\nStatus: none observed`
  return `${CI_FAILURES_HEADER}\nStatus: failures observed\n\n${markdownBlocks.join('\n\n')}`
}
