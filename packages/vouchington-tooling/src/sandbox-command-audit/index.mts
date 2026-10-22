export { parseAuditArgs } from './args.mts'
export type { AuditArgs } from './args.mts'
export { classifyAudit } from './classify.mts'
export type {
  BlockCandidate,
  CategorizedAudit,
  CoverageList,
  CoveragePolicy,
  EscalationPressure,
  GenuineBypassCandidate,
  KindCount,
  PrefixCount,
} from './classify.mts'
export { createClaudeRecordExtractor, extractClaudeRecords } from './claude-extract.mts'
export type { ClaudeExtraction, ClaudeRecordExtractor } from './claude-extract.mts'
export { scanCodexFile } from './codex-scan.mts'
export { createCodexRecordExtractor, extractCodexRecords } from './codex-extract.mts'
export type { CodexExtraction, CodexRecordExtractor } from './codex-extract.mts'
export { discoverTranscriptFiles } from './discover-files.mts'
export type { DiscoverOptions, DiscoveredFiles } from './discover-files.mts'
export { classifyFailureText } from './failure-text.mts'
export { DEFAULT_LIMITS, resolveLimits } from './limits.mts'
export type { AuditLimits, RawRetention } from './limits.mts'
export { HEADER, formatMarkdown, formatReport } from './report.mts'
export type { ReportOptions } from './report.mts'
export { formatRaw } from './report-raw.mts'
export { isWithinRepoRoots, resolveRepoRoots } from './repo-scope.mts'
export type { RepoScopeDeps, RepoScopeOptions } from './repo-scope.mts'
export { loadAuditRules, runAudit } from './run.mts'
export type { AuditRules, PolicyContext } from './run.mts'
export { scanTranscripts } from './scan.mts'
export type { ScanOptions } from './scan.mts'
export { claudeProjectCwdResolver, readTranscriptCwd } from './transcript-cwd.mts'
export { emptyScanResult } from './types.mts'
export type {
  ClassifyFailure,
  ClaudeDenialRecord,
  ClaudeEscalationRecord,
  ClaudeSandboxFailureRecord,
  ClaudeToolDenialKind,
  CodexSandboxFailureRecord,
  FailureKind,
  ScanResult,
  ScanRules,
  SkipCounts,
} from './types.mts'
