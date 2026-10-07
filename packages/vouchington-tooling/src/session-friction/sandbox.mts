import type { FrictionEvent, FrictionEventKind } from './types.mts'
import { byteLength, fitFields, selectWithin } from './audit-fit.mts'
import { markdownAuditUnits, type AuditRedactor } from './text.mts'

const SANDBOX_SECTION_HEADER = '## Sandbox & Permission Audit'
const SANDBOX_SECTION_MAX_BYTES = 3_000
// Room for the `- kind (n)` group lines, which are rendered outside the per-event budget.
const GROUP_LINES_BYTES = 120
// Below this an event line would keep little beyond its timestamp, so it is omitted and counted.
const MIN_EVENT_SHARE_BYTES = 120
// Event line fields: command prefix, detail, timestamp. Cut detail first, the timestamp never.
const SHRINK_ORDER = [1, 0]
const KIND_ORDER: FrictionEventKind[] = [
  'sandbox-escalation',
  'sandbox-failure',
  'ambiguous-failure',
]

/** Reports dropped events as a group in the same shape as the rest, so omission is never silent. */
function omissionGroup(count: number): string {
  return `- omitted (${count})\n  - see journal — ${count} events omitted to fit the size limit — n/a`
}

export function buildSandboxSection(
  events: FrictionEvent[],
  redact?: AuditRedactor,
  maxBytes = SANDBOX_SECTION_MAX_BYTES,
): string {
  const observations = events.flatMap((event) =>
    event.failure
      ? [event, { ...event, kind: event.failure.kind, detail: event.failure.detail }]
      : [event],
  )
  const render = (event: FrictionEvent, budgetBytes: number): string => {
    const outcome =
      event.kind === 'sandbox-escalation' ? ` — outcome: ${event.outcome ?? 'unknown'}` : ''
    const [prefix, detail, timestamp] = fitFields(
      [event.commandPrefix, event.detail, event.timestamp].map((field) =>
        markdownAuditUnits(field, redact),
      ),
      byteLength(`  -  —  — ${outcome}`),
      budgetBytes,
      SHRINK_ORDER,
    )
    return `  - ${prefix} — ${detail} — ${timestamp}${outcome}`
  }
  const total = Math.max(0, Math.min(maxBytes, SANDBOX_SECTION_MAX_BYTES) - GROUP_LINES_BYTES)
  const { rendered, omitted } = selectWithin(
    observations,
    total,
    byteLength(omissionGroup(observations.length)) + 1,
    1,
    MIN_EVENT_SHARE_BYTES,
    render,
  )
  const kept = observations
    .slice(0, rendered.length)
    .map((event, i) => ({ event, line: rendered[i]! }))
  const groups = KIND_ORDER.map((kind) => {
    const selected = kept.filter(({ event }) => event.kind === kind)
    return selected.length
      ? [`- ${kind} (${selected.length})`, ...selected.map(({ line }) => line)].join('\n')
      : undefined
  }).filter((group): group is string => group !== undefined)
  if (omitted) groups.push(omissionGroup(omitted))
  return `${SANDBOX_SECTION_HEADER}\nEvents observed: ${observations.length}\n\n${groups.join('\n')}`
}
