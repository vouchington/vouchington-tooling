import { conformingBlocks, matchAuditBlock } from '../session-friction/audit-block.mts'
import type { AuditRender } from '../session-friction/audit-fit.mts'
import type { AuditRedactor } from '../session-friction/text.mts'
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

const SANDBOX_BLOCKS_MAX_BYTES = 3_000

function matchBlock(markdown: string, render: AuditRender): string | null {
  return (
    matchAuditBlock(markdown, ESCALATION, FIELD_PREFIXES, render) ??
    matchAuditBlock(markdown, FAILURE, FIELD_PREFIXES, render)
  )
}

/** Journal entries that hold exactly one sandbox or permission block, made paste-safe. */
export function getConformingSandboxBlocks(
  entries: Iterable<JournalEntry>,
  redact?: AuditRedactor,
): string[] {
  return conformingBlocks(entries, matchBlock, SANDBOX_BLOCKS_MAX_BYTES, redact)
}

export function unavailableSandboxSection(reason: string, blocks: string[] = []): string {
  return [`${SANDBOX_SECTION_HEADER}\nStatus: unavailable (${reason})`, ...blocks].join('\n\n')
}

export function journalSandboxSection(blocks: string[]): string {
  if (blocks.length === 0) return `${SANDBOX_SECTION_HEADER}\nStatus: none observed (${SOURCE})`
  return `${SANDBOX_SECTION_HEADER}\nStatus: events observed (${SOURCE})\n\n${blocks.join('\n\n')}`
}
