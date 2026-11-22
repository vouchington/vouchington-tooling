export const DEFAULT_FIXTURE_DEADLINE_MS = 4000

/**
 * Starts a wall-clock budget for one test case and returns a function that yields the whole
 * milliseconds still left, for use as a per-call timeout. It throws once the budget is spent, so a
 * slow fixture fails loudly instead of hanging. `timeoutMs` defaults to `DEFAULT_FIXTURE_DEADLINE_MS`.
 */
export function createFixtureDeadline(
  timeoutMs: number = DEFAULT_FIXTURE_DEADLINE_MS,
): () => number {
  const deadline = process.hrtime.bigint() + BigInt(Math.round(timeoutMs)) * 1_000_000n
  return () => {
    const milliseconds = Number((deadline - process.hrtime.bigint()) / 1_000_000n)
    if (milliseconds <= 0) throw new Error('Analyzer fixture case deadline exhausted')
    return milliseconds
  }
}
