import type { FrictionEvent, FrictionEventKind } from './types.mts'
import { fitFields } from './audit-fit.mts'
import { markdownAuditUnits, type AuditRedactor } from './text.mts'

const SANDBOX_SECTION_HEADER = '## Sandbox & Permission Audit'
const SANDBOX_SECTION_MAX_BYTES = 3_000
const MIN_EVENT_BYTES = 150
const KIND_ORDER: FrictionEventKind[] = [
  'sandbox-escalation',
  'sandbox-failure',
  'ambiguous-failure',
]

export function buildSandboxSection(events: FrictionEvent[], redact?: AuditRedactor): string {
  const observations = events.flatMap((event) =>
    event.failure
      ? [event, { ...event, kind: event.failure.kind, detail: event.failure.detail }]
      : [event],
  )
  // Fields stay whole until the events together would overflow the section, then share it equally.
  const eventBytes = Math.max(
    MIN_EVENT_BYTES,
    Math.floor(SANDBOX_SECTION_MAX_BYTES / observations.length),
  )
  const render = (event: FrictionEvent): string => {
    const outcome =
      event.kind === 'sandbox-escalation' ? ` — outcome: ${event.outcome ?? 'unknown'}` : ''
    const [prefix, detail, timestamp] = fitFields(
      [event.commandPrefix, event.detail, event.timestamp].map((field) =>
        markdownAuditUnits(field, redact),
      ),
      Buffer.byteLength(`  -  —  — ${outcome}`),
      eventBytes,
    )
    return `  - ${prefix} — ${detail} — ${timestamp}${outcome}`
  }
  const groups = KIND_ORDER.map((kind) => {
    const selected = observations.filter((event) => event.kind === kind)
    return selected.length
      ? [`- ${kind} (${selected.length})`, ...selected.map(render)].join('\n')
      : undefined
  }).filter((group): group is string => group !== undefined)
  return `${SANDBOX_SECTION_HEADER}\nEvents observed: ${observations.length}\n\n${groups.join('\n')}`
}
