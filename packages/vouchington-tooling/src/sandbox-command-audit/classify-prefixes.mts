import { normalizeCommandPrefix } from '../retrospective-transcript/index.mts'

export type PrefixCount = { prefix: string; count: number }

/** Which list of an injected policy a command is checked against. */
export type CoverageList = 'allow' | 'deny' | 'excluded'

/**
 * The repository's own answer to "is this already handled": the caller loads its settings from
 * wherever and in whatever format it keeps them, and exposes only this question. `allow` and
 * `excluded` receive a normalized prefix; `deny` receives each raw command.
 */
export type CoveragePolicy = { covers: (list: CoverageList, commandOrPrefix: string) => boolean }

// A command that could not be normalized (uncorrelated, or no command text) is still counted so
// it is never a silent drop; it just cannot anchor a per-prefix row.
const UNRESOLVED_PREFIX = ''

export function groupByPrefix(commands: Array<string | undefined>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const command of commands) {
    const prefix = command ? normalizeCommandPrefix(command) : UNRESOLVED_PREFIX
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }
  return counts
}

export function toSortedPrefixCounts(counts: Map<string, number>): PrefixCount[] {
  const entries: PrefixCount[] = []
  for (const [prefix, count] of counts) {
    if (prefix !== UNRESOLVED_PREFIX) entries.push({ prefix, count })
  }
  return entries.toSorted((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix))
}

export function unresolvedCount(counts: Map<string, number>): number {
  return counts.get(UNRESOLVED_PREFIX) ?? 0
}

// Checked per raw command, because deny rules can run deeper than the two-token prefix depth. A
// prefix group is "covered" only when every command in it is: one uncovered instance leaves the
// group for human review.
export function coverageByPrefix(
  commands: Array<string | undefined>,
  list: CoverageList,
  policy: CoveragePolicy,
): Map<string, boolean> {
  const coverage = new Map<string, boolean>()
  for (const command of commands) {
    if (!command) continue
    const prefix = normalizeCommandPrefix(command)
    coverage.set(prefix, (coverage.get(prefix) ?? true) && policy.covers(list, command))
  }
  return coverage
}

export function splitByCoverage(
  counts: Map<string, number>,
  list: CoverageList,
  policy: CoveragePolicy,
): { covered: PrefixCount[]; uncovered: PrefixCount[]; unresolvedCount: number } {
  const covered = new Map<string, number>()
  const uncovered = new Map<string, number>()
  for (const [prefix, count] of counts) {
    if (prefix === UNRESOLVED_PREFIX) continue
    ;(policy.covers(list, prefix) ? covered : uncovered).set(prefix, count)
  }
  return {
    covered: toSortedPrefixCounts(covered),
    uncovered: toSortedPrefixCounts(uncovered),
    unresolvedCount: unresolvedCount(counts),
  }
}
