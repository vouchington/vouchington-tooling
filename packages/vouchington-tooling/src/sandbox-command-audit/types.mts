import type { AuditLimits, RawRetention } from './limits.mts'

export type ClaudeToolDenialKind = 'user-rejected' | 'permission-rule' | 'automode-blocked'

/** A failure bucket. `e2big` and `genuine` are built in; a rule may return any other label. */
export type FailureKind = string

/** A Claude Bash tool_use with `input.dangerouslyDisableSandbox: true`. */
export type ClaudeEscalationRecord = {
  source: 'claude'
  command: string
}

/** A Claude tool_result with a top-level `toolDenialKind`; `command` is unset when uncorrelated. */
export type ClaudeDenialRecord = {
  source: 'claude'
  kind: ClaudeToolDenialKind
  command?: string | undefined
}

/** A Claude Bash tool_result with `is_error: true` whose text matched a failure signature. */
export type ClaudeSandboxFailureRecord = {
  source: 'claude'
  kind: FailureKind
  command?: string | undefined
  errorText: string
}

/** A Codex CommandExecution whose output an injected rule classified. */
export type CodexSandboxFailureRecord = {
  source: 'codex'
  kind: FailureKind
  command?: string | undefined
  errorText: string
}

/** Per-source counts of files dropped by repo scoping, so a cross-repo leak is never silent. */
export type SkipCounts = { claude: number; codex: number }

/**
 * Failure classification supplied by the caller. It runs after the E2BIG check and before the
 * built-in permission signatures, so a repository can claim a failure for its own bucket (for
 * example a write-path denial that needs a sandbox config fix rather than an allow entry).
 */
export type ClassifyFailure = (
  command: string | undefined,
  text: string,
  source: 'claude' | 'codex',
) => FailureKind | undefined

export type ScanRules = {
  classifyFailure?: ClassifyFailure | undefined
  limits?: Partial<AuditLimits>
}

export type ScanResult = {
  claudeEscalations: ClaudeEscalationRecord[]
  claudeDenials: ClaudeDenialRecord[]
  claudeSandboxFailures: ClaudeSandboxFailureRecord[]
  codexSandboxFailures: CodexSandboxFailureRecord[]
  claudeFilesScanned: number
  codexFilesScanned: number
  readErrors: string[]
  repoRoots: string[]
  skippedOtherRepo: SkipCounts
  skippedUnknownCwd: SkipCounts
  /** Raw values exist for `--raw`; every cap is reported so a bounded run never looks complete. */
  rawRetention: RawRetention
}

export function emptyScanResult(): ScanResult {
  return {
    claudeEscalations: [],
    claudeDenials: [],
    claudeSandboxFailures: [],
    codexSandboxFailures: [],
    claudeFilesScanned: 0,
    codexFilesScanned: 0,
    readErrors: [],
    repoRoots: [],
    skippedOtherRepo: { claude: 0, codex: 0 },
    skippedUnknownCwd: { claude: 0, codex: 0 },
    rawRetention: {
      commandTextsTruncated: 0,
      errorTextsTruncated: 0,
      pendingToolUsesDropped: 0,
      pendingToolUseBytesDropped: 0,
      recordsDropped: 0,
      rawBytesDropped: 0,
      retainedRawBytes: 0,
    },
  }
}
