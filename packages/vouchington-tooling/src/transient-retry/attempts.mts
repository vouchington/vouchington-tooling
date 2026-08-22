/**
 * Normalizes a provider's attempt count when earlier attempts produced no targets.
 * Provider API fetching and parsing intentionally remain outside this package.
 */
export function deriveRetryAttempt(
  runAttempt: number,
  priorTargetCounts: readonly number[],
): number {
  const emptyPriorAttempts = priorTargetCounts.filter((count) => count === 0).length
  return Math.max(1, runAttempt - emptyPriorAttempts)
}
