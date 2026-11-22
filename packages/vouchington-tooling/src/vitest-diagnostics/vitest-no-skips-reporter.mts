import type { Reporter } from 'vitest/node'

type RunEndReason = Parameters<NonNullable<Reporter['onTestRunEnd']>>[2]
// Only the cardinality of the public filtered collection is needed, not TestCase internals.
type CompletedModule = { children: { allTests(state: 'skipped'): Iterable<unknown> } }

/**
 * Fails an otherwise passing run when any test result is skipped. A failed or interrupted run,
 * or one with unhandled errors, keeps its own outcome and gets no second error.
 */
export class VitestNoSkipsReporter implements Reporter {
  async onTestRunEnd(
    modules: ReadonlyArray<CompletedModule>,
    unhandledErrors: ReadonlyArray<unknown>,
    reason: RunEndReason,
  ): Promise<void> {
    if (reason !== 'passed' || unhandledErrors.length > 0) return
    let skipped = 0
    for (const testModule of modules) {
      skipped += Array.from(testModule.children.allTests('skipped')).length
    }
    if (skipped > 0) {
      // Async rejection lets Vitest invoke every reporter hook before Promise.all rejects.
      // Do not rewrite testcase results: JUnit and the other reporters keep the skipped evidence.
      throw new Error(
        `Whole-test skips are forbidden in CI: ${skipped} skipped results. Inspect the JUnit report and test output.`,
      )
    }
  }
}
