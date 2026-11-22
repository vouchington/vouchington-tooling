import type { Reporter } from 'vitest/node'

type RunEndReason = Parameters<NonNullable<Reporter['onTestRunEnd']>>[2]
// Only the cardinality of the public filtered collection is needed, not TestCase internals.
type CompletedModule = { children: { allTests(state: 'skipped'): Iterable<unknown> } }

/**
 * Fails an otherwise passing run when any test result is skipped. A failed or interrupted run,
 * or one with unhandled errors, keeps its own outcome and gets no second error.
 */
export class VitestNoSkipsReporter implements Reporter {
  onTestRunEnd(
    modules: ReadonlyArray<CompletedModule>,
    unhandledErrors: ReadonlyArray<unknown>,
    reason: RunEndReason,
  ): void {
    if (reason !== 'passed' || unhandledErrors.length > 0) return
    let skipped = 0
    for (const testModule of modules) {
      skipped += Array.from(testModule.children.allTests('skipped')).length
    }
    if (skipped > 0) {
      // Do not reject: Vitest awaits this hook before reporting coverage, so a rejection would
      // skip coverage reports and threshold checks. Fail the process instead, as Vitest itself
      // does. Testcase results stay untouched so JUnit and other reporters keep the evidence.
      process.exitCode = 1
      process.stderr.write(
        `Whole-test skips are forbidden in CI: ${skipped} skipped results. Inspect the JUnit report and test output.\n`,
      )
    }
  }
}
