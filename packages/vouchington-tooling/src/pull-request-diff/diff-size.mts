export type DiffLineChanges = {
  added: number
  deleted: number
}

export type LargeDiffThresholds = {
  /** A diff adding strictly more lines than this is large. */
  addedLines: number
  /** A diff deleting strictly more lines than this is large. */
  deletedLines: number
}

/**
 * Example thresholds for a "decide whether to split this PR" gate: additions are the trigger for a
 * split, while deletion-heavy retirement work stays coherent at a larger limit. Callers pass their
 * own `LargeDiffThresholds`; these are only a default.
 */
export const DEFAULT_LARGE_DIFF_THRESHOLDS: Readonly<LargeDiffThresholds> = Object.freeze({
  addedLines: 5000,
  deletedLines: 20_000,
})

/**
 * Added + removed lines in a unified diff (`git diff <base>...HEAD` output), excluding the
 * `+++`/`---` file-header lines so renamed/moved files don't double-count their path lines.
 *
 * Known limitation: this matches the literal `+++`/`---` prefix, not "is this actually a file
 * header." An added line whose content starts with `++`, or a removed line whose content starts
 * with `--` (a SQL comment, a CLI flag), renders as `+++`/`---` once the diff marker is prepended
 * and is silently excluded from the count. For a coarse "probably needs a split" heuristic with an
 * explicit override, that undercount is acceptable; this is not a full hunk parser.
 */
export function countDiffLineChanges(diffText: string): DiffLineChanges {
  const changes: DiffLineChanges = { added: 0, deleted: 0 }
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) changes.added++
    else if (line.startsWith('-')) changes.deleted++
  }
  return changes
}

/** True when either count is strictly greater than its threshold. */
export function exceedsLargeDiffThreshold(
  changes: DiffLineChanges,
  thresholds: LargeDiffThresholds = DEFAULT_LARGE_DIFF_THRESHOLDS,
): boolean {
  return changes.added > thresholds.addedLines || changes.deleted > thresholds.deletedLines
}
