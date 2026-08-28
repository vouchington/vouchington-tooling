import type { FrictionEvent, FrictionEventKind } from './types.mts'
import { markdownAuditText } from './text.mts'

const SANDBOX_SECTION_HEADER = '## Sandbox & Permission Audit'
const KIND_ORDER: FrictionEventKind[] = ['sandbox-escalation', 'sandbox-failure']

export function buildSandboxSection(events: FrictionEvent[]): string {
  const groups = KIND_ORDER.map((kind) => {
    const selected = events.filter((event) => event.kind === kind)
    return selected.length
      ? [
          `- ${kind} (${selected.length})`,
          ...selected.map(
            (event) =>
              `  - ${markdownAuditText(event.commandPrefix)} — ${markdownAuditText(event.detail)} — ${markdownAuditText(event.timestamp)}`,
          ),
        ].join('\n')
      : undefined
  }).filter((group): group is string => group !== undefined)
  return `${SANDBOX_SECTION_HEADER}\nEvents observed: ${events.length}\n\n${groups.join('\n')}`
}
