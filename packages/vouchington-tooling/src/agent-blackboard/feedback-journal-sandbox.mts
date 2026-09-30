import { conformingBlocks, matchAuditBlock } from '../session-friction/audit-block.mts'
import type { JournalEntry } from '../session-friction/types.mts'

const SANDBOX_SECTION_HEADER = '## Sandbox & Permission Audit'
const SOURCE = 'journal entries only; no friction log observed'

const EVIDENCE = /^ {2}- Evidence: .*[^\s]$/
const DISPOSITION = /^ {2}- Disposition: .*[^\s]$/
const ESCALATION = [
  /^- `sandbox-escalation` — .+ — .*[^\s]$/,
  /^ {2}- Outcome: (?:requested|approved|denied|unknown)$/,
  EVIDENCE,
  DISPOSITION,
]
const FAILURE = [
  /^- `(?:sandbox-failure|ambiguous-failure)` — .+ — .*[^\s]$/,
  EVIDENCE,
  DISPOSITION,
]
const FIELD_PREFIXES = [
  '- `sandbox-escalation` — ',
  '- `sandbox-failure` — ',
  '- `ambiguous-failure` — ',
  '  - Outcome: ',
  '  - Evidence: ',
  '  - Disposition: ',
]

function matchBlock(markdown: string): string | null {
  return (
    matchAuditBlock(markdown, ESCALATION, FIELD_PREFIXES) ??
    matchAuditBlock(markdown, FAILURE, FIELD_PREFIXES)
  )
}

/** Journal entries that hold exactly one sandbox or permission block, made paste-safe. */
export function getConformingSandboxBlocks(entries: Iterable<JournalEntry>): string[] {
  return conformingBlocks(entries, matchBlock)
}

export function unavailableSandboxSection(reason: string, blocks: string[] = []): string {
  return [`${SANDBOX_SECTION_HEADER}\nStatus: unavailable (${reason})`, ...blocks].join('\n\n')
}

export function journalSandboxSection(blocks: string[]): string {
  if (blocks.length === 0) return `${SANDBOX_SECTION_HEADER}\nStatus: none observed (${SOURCE})`
  return `${SANDBOX_SECTION_HEADER}\nStatus: events observed (${SOURCE})\n\n${blocks.join('\n\n')}`
}
