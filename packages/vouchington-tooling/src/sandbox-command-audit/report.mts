import type { CategorizedAudit, PrefixCount } from './classify.mts'
import { HEADER, formatRaw, scopeLine } from './report-raw.mts'
import type { ScanResult } from './types.mts'

export { HEADER } from './report-raw.mts'

export type ReportOptions = { json?: boolean; raw?: boolean }

const NONE = ['  (none)']

function rows<T extends PrefixCount>(entries: T[], note: (entry: T) => string): string[] {
  return entries.length > 0
    ? entries.map((entry) => `  - ${entry.prefix} (${entry.count})${note(entry)}`)
    : NONE
}

function unresolvedNote(count: number): string[] {
  return count > 0 ? [`  (+${count} with an unresolved command — rerun with --raw to inspect)`] : []
}

function rawRetentionLines(retention: ScanResult['rawRetention']): string[] {
  const count =
    retention.commandTextsTruncated +
    retention.errorTextsTruncated +
    retention.pendingToolUsesDropped +
    retention.recordsDropped
  if (count === 0) return []
  return [
    `Raw retention bounded: ${retention.commandTextsTruncated} command text(s), ${retention.errorTextsTruncated} error text(s), ${retention.pendingToolUsesDropped} pending tool use(s), ${retention.recordsDropped} record(s) truncated or dropped; ${retention.pendingToolUseBytesDropped} pending and ${retention.rawBytesDropped} raw byte(s) evicted. Aggregate output may be incomplete.`,
  ]
}

function otherFailureLines(audit: CategorizedAudit): string[] {
  if (audit.otherFailures.length === 0) return []
  const total = audit.otherFailures.reduce((sum, entry) => sum + entry.count, 0)
  return [
    `## Other classified sandbox failures (not allow-list candidates): ${total}`,
    ...audit.otherFailures.map((entry) => `  - ${entry.kind} (${entry.count})`),
    '  (rerun with --raw to inspect the failure text)',
    '',
  ]
}

/** Default rendering: normalized prefixes and counts only, never full command or error text. */
export function formatMarkdown(audit: CategorizedAudit): string {
  const pressure = audit.escalationPressure
  const lines = [
    HEADER,
    scopeLine(audit),
    '',
    '## 1. Genuine bypass candidates (real permission/access failures, not E2BIG)',
    ...rows(audit.genuineBypassCandidates, (e) =>
      e.alreadyInAllowList ? ' [already allowed]' : '',
    ),
    ...unresolvedNote(audit.genuineBypassUnresolvedCount),
    '',
    '## 2. Block candidates (human explicitly rejected the command)',
    ...rows(audit.blockCandidates, (e) => (e.alreadyDenied ? ' [already denied]' : '')),
    ...unresolvedNote(audit.blockCandidateUnresolvedCount),
    '',
    '## 3. Escalation pressure (root cause — dangerouslyDisableSandbox)',
    'Claude — already covered by the excluded-commands list:',
    ...rows(pressure.claudeCovered, () => ''),
    'Claude — NOT covered (candidates to add to the excluded-commands list):',
    ...rows(pressure.claudeUncovered, () => ''),
    ...unresolvedNote(pressure.claudeUnresolvedCount),
    `E2BIG failures (argument-list-too-long sandbox artifact, separate root cause — not a candidate list): ${pressure.e2bigCount}`,
    '',
    `## Denial hygiene (block policy already working as intended): ${audit.policyBlockCount}`,
    '',
    ...otherFailureLines(audit),
    `Scanned ${audit.claudeFilesScanned} Claude transcript file(s), ${audit.codexFilesScanned} Codex transcript file(s).`,
    ...(audit.readErrorCount > 0
      ? [`Read errors: ${audit.readErrorCount} (rerun with --raw to inspect)`]
      : []),
    ...rawRetentionLines(audit.rawRetention),
  ]
  return `${lines.join('\n')}\n`
}

export function formatReport(
  scan: ScanResult,
  audit: CategorizedAudit,
  options: ReportOptions = {},
): string {
  if (options.json) return `${JSON.stringify(options.raw ? scan : audit, null, 2)}\n`
  return options.raw ? formatRaw(scan) : formatMarkdown(audit)
}
