import type { ScanResult, SkipCounts } from './types.mts'

export const HEADER = '=== Sandbox Command Audit ==='

const RAW_WARNING =
  '⚠ RAW MODE — full commands and sandbox-failure text below. Local inspection only. Never paste this section into a retro (privacy boundary).'

type ScopeInfo = {
  repoRoots: string[]
  claudeFilesScanned: number
  codexFilesScanned: number
  skippedOtherRepo: SkipCounts
  skippedUnknownCwd: SkipCounts
}

/** Names the repo scope and what it dropped, so a cross-repo leak shows up in the report. */
export function scopeLine(info: ScopeInfo): string {
  const [primaryRoot, ...worktreeRoots] = info.repoRoots
  const root = primaryRoot ?? '(no repo root resolved)'
  const plural = worktreeRoots.length === 1 ? '' : 's'
  const worktreeSuffix =
    worktreeRoots.length > 0 ? ` (+${worktreeRoots.length} worktree${plural})` : ''
  const otherRepo = info.skippedOtherRepo.claude + info.skippedOtherRepo.codex
  const unknownCwd = info.skippedUnknownCwd.claude + info.skippedUnknownCwd.codex
  const skipParts = [
    otherRepo > 0 ? `${otherRepo} skipped (other repo)` : undefined,
    unknownCwd > 0 ? `${unknownCwd} skipped (cwd unknown)` : undefined,
  ].filter((part): part is string => part !== undefined)
  const skipSuffix = skipParts.length > 0 ? `; ${skipParts.join(', ')}` : ''
  return `Scope: ${root}${worktreeSuffix} — ${info.claudeFilesScanned} Claude / ${info.codexFilesScanned} Codex files scanned${skipSuffix}`
}

/** Warns that caps dropped or truncated records, so a bounded run never looks complete. */
export function rawRetentionLines(retention: ScanResult['rawRetention']): string[] {
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

/** The one rendering that crosses the privacy boundary; it is only reachable behind `--raw`. */
export function formatRaw(scan: ScanResult): string {
  const failure = (record: {
    kind: string
    command?: string | undefined
    errorText: string
  }): string => `  - [${record.kind}] ${record.command ?? '(unresolved)'}: ${record.errorText}`
  const lines = [
    HEADER,
    scopeLine(scan),
    RAW_WARNING,
    '',
    `## Claude escalations (dangerouslyDisableSandbox) — ${scan.claudeEscalations.length}`,
    ...scan.claudeEscalations.map((record) => `  - ${record.command}`),
    '',
    `## Claude denials — ${scan.claudeDenials.length}`,
    ...scan.claudeDenials.map(
      (record) => `  - [${record.kind}] ${record.command ?? '(unresolved)'}`,
    ),
    '',
    `## Claude sandbox failures — ${scan.claudeSandboxFailures.length}`,
    ...scan.claudeSandboxFailures.map(failure),
    '',
    `## Codex sandbox failures — ${scan.codexSandboxFailures.length}`,
    ...scan.codexSandboxFailures.map(failure),
    '',
    `## Read errors — ${scan.readErrors.length}`,
    ...scan.readErrors.map((error) => `  - ${error}`),
    ...rawRetentionLines(scan.rawRetention),
  ]
  return `${lines.join('\n')}\n`
}
