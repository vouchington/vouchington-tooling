import {
  coverageByPrefix,
  groupByPrefix,
  splitByCoverage,
  toSortedPrefixCounts,
  unresolvedCount,
  type CoveragePolicy,
  type PrefixCount,
} from './classify-prefixes.mts'
import type { ScanResult, SkipCounts } from './types.mts'

export type { CoverageList, CoveragePolicy, PrefixCount } from './classify-prefixes.mts'
export type GenuineBypassCandidate = PrefixCount & { alreadyInAllowList: boolean }
export type BlockCandidate = PrefixCount & { alreadyDenied: boolean }
export type KindCount = { kind: string; count: number }

export type EscalationPressure = {
  claudeCovered: PrefixCount[]
  claudeUncovered: PrefixCount[]
  claudeUnresolvedCount: number
  e2bigCount: number
}

/**
 * The privacy boundary: this is what `--json` serializes, so it carries only normalized prefixes
 * and counts. Read-error paths and failure text exist only on `ScanResult`, as counts here.
 */
export type CategorizedAudit = {
  genuineBypassCandidates: GenuineBypassCandidate[]
  genuineBypassUnresolvedCount: number
  blockCandidates: BlockCandidate[]
  blockCandidateUnresolvedCount: number
  escalationPressure: EscalationPressure
  policyBlockCount: number
  /** Failures a caller rule put in its own bucket, by kind. Never counted as bypass candidates. */
  otherFailures: KindCount[]
  claudeFilesScanned: number
  codexFilesScanned: number
  readErrorCount: number
  repoRoots: string[]
  skippedOtherRepo: SkipCounts
  skippedUnknownCwd: SkipCounts
  rawRetention: ScanResult['rawRetention']
}

const BUILT_IN_KINDS = new Set(['genuine', 'e2big'])

function classifyGenuine(scan: ScanResult, policy: CoveragePolicy) {
  const commands = scan.claudeSandboxFailures
    .filter((record) => record.kind === 'genuine')
    .map((record) => record.command)
  const counts = groupByPrefix(commands)
  const candidates = toSortedPrefixCounts(counts).map((entry) => ({
    ...entry,
    alreadyInAllowList: policy.covers('allow', entry.prefix),
  }))
  return { candidates, unresolvedCount: unresolvedCount(counts) }
}

function classifyBlocks(scan: ScanResult, policy: CoveragePolicy) {
  const commands = scan.claudeDenials
    .filter((record) => record.kind === 'user-rejected')
    .map((record) => record.command)
  const counts = groupByPrefix(commands)
  const denied = coverageByPrefix(commands, 'deny', policy)
  const candidates = toSortedPrefixCounts(counts).map((entry) => ({
    ...entry,
    alreadyDenied: denied.get(entry.prefix) === true,
  }))
  return { candidates, unresolvedCount: unresolvedCount(counts) }
}

function classifyEscalations(scan: ScanResult, policy: CoveragePolicy): EscalationPressure {
  const counts = groupByPrefix(scan.claudeEscalations.map((record) => record.command))
  const split = splitByCoverage(counts, 'excluded', policy)
  return {
    claudeCovered: split.covered,
    claudeUncovered: split.uncovered,
    claudeUnresolvedCount: split.unresolvedCount,
    e2bigCount: scan.claudeSandboxFailures.filter((record) => record.kind === 'e2big').length,
  }
}

function otherFailureCounts(scan: ScanResult): KindCount[] {
  const counts = new Map<string, number>()
  for (const { kind } of [...scan.claudeSandboxFailures, ...scan.codexSandboxFailures]) {
    if (!BUILT_IN_KINDS.has(kind)) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .toSorted((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
}

/**
 * Sorts a scan into report buckets against the caller's policy. Bypass candidates come from
 * Claude's real permission failures; Codex escalations are not scanned here because Codex agents
 * journal them separately.
 */
export function classifyAudit(scan: ScanResult, policy: CoveragePolicy): CategorizedAudit {
  const genuine = classifyGenuine(scan, policy)
  const block = classifyBlocks(scan, policy)
  return {
    genuineBypassCandidates: genuine.candidates,
    genuineBypassUnresolvedCount: genuine.unresolvedCount,
    blockCandidates: block.candidates,
    blockCandidateUnresolvedCount: block.unresolvedCount,
    escalationPressure: classifyEscalations(scan, policy),
    policyBlockCount: scan.claudeDenials.filter(
      (record) => record.kind === 'permission-rule' || record.kind === 'automode-blocked',
    ).length,
    otherFailures: otherFailureCounts(scan),
    claudeFilesScanned: scan.claudeFilesScanned,
    codexFilesScanned: scan.codexFilesScanned,
    readErrorCount: scan.readErrors.length,
    repoRoots: scan.repoRoots,
    skippedOtherRepo: scan.skippedOtherRepo,
    skippedUnknownCwd: scan.skippedUnknownCwd,
    rawRetention: scan.rawRetention,
  }
}
