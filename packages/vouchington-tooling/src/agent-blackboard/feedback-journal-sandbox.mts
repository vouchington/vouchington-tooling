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

// Cut Disposition first, then the header detail, and Evidence last; Outcome is never cut.
const ESCALATION_SHRINK_ORDER = [3, 0, 2]
const FAILURE_SHRINK_ORDER = [2, 0, 1]

function matchBlock(markdown: string, render: AuditRender): string | null {
  return (
    matchAuditBlock(markdown, ESCALATION, FIELD_PREFIXES, {
      ...render,
      shrinkOrder: ESCALATION_SHRINK_ORDER,
    }) ??
    matchAuditBlock(markdown, FAILURE, FIELD_PREFIXES, {
      ...render,
      shrinkOrder: FAILURE_SHRINK_ORDER,
    })
  )
}

/** A conforming block that reports dropped blocks, so omission is never silent. */
function omissionBlock(count: number): string {
  return [
    `- \`ambiguous-failure\` — omitted — ${count} sandbox blocks omitted to fit the size limit; see journal`,
    '  - Evidence: omitted blocks remain in the session journal',
    '  - Disposition: see journal for the omitted blocks',
  ].join('\n')
}

/** Journal entries that hold exactly one sandbox or permission block, made paste-safe. */
export function getConformingSandboxBlocks(
  entries: Iterable<JournalEntry>,
  redact?: AuditRedactor,
  maxBytes = SANDBOX_BLOCKS_MAX_BYTES,
): string[] {
  return conformingBlocks(
    entries,
    matchBlock,
    Math.min(maxBytes, SANDBOX_BLOCKS_MAX_BYTES),
    redact,
    omissionBlock,
  )
}

export function unavailableSandboxSection(reason: string, blocks: string[] = []): string {
  return [`${SANDBOX_SECTION_HEADER}\nStatus: unavailable (${reason})`, ...blocks].join('\n\n')
}

export function journalSandboxSection(blocks: string[]): string {
  if (blocks.length === 0) return `${SANDBOX_SECTION_HEADER}\nStatus: none observed (${SOURCE})`
  return `${SANDBOX_SECTION_HEADER}\nStatus: events observed (${SOURCE})\n\n${blocks.join('\n\n')}`
}
