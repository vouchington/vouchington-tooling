import { TestRunner } from 'vitest'
import { assertGuardedDatabaseName, getSharedDbScopeViolationStore } from './violations-store.mts'

export interface SharedDbScopeGuardRunnerOptions<
  Base extends typeof TestRunner = typeof TestRunner,
> {
  /** Logical name of the guarded database matching `createSharedDbScopeGuard({ database })`. */
  database: string
  /** Optional base runner class to extend for runner composition. Defaults to Vitest `TestRunner`. */
  baseRunner?: Base
}

/**
 * Builds a Vitest `TestRunner` subclass that fails any test file with unreported shared-DB scope
 * violations, even when application code caught the immediate throw or it happened during import
 * or teardown hooks.
 */
export function createSharedDbScopeGuardRunner<Base extends typeof TestRunner = typeof TestRunner>(
  options: SharedDbScopeGuardRunnerOptions<Base>,
): Base {
  const database = assertGuardedDatabaseName(options.database)
  const store = getSharedDbScopeViolationStore(database)
  const BaseRunner = (options.baseRunner ?? TestRunner) as typeof TestRunner

  class SharedDbScopeGuardRunner extends BaseRunner {
    override async importFile(
      filepath: string,
      source: Parameters<TestRunner['importFile']>[1],
    ): Promise<void> {
      try {
        await super.importFile(filepath, source)
      } catch (err) {
        const violations = store.unreported(filepath)
        store.markReported(filepath)
        if (violations.length === 0) throw err
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}\n\n${violations.map((violation) => violation.message).join('\n')}`,
          { cause: err },
        )
      }
    }

    override async onBeforeRunSuite(suite: Parameters<TestRunner['onBeforeRunSuite']>[0]) {
      await super.onBeforeRunSuite(suite)
      const isSkipped = suite.mode === 'skip' || suite.mode === 'todo'
      if (suite.result?.state === 'fail' || isSkipped) {
        this.#reportFileViolations(suite, isSkipped)
      }
    }

    override async onAfterRunSuite(suite: Parameters<TestRunner['onAfterRunSuite']>[0]) {
      await super.onAfterRunSuite(suite)
      this.#reportFileViolations(suite, false)
    }

    #reportFileViolations(
      suite: Parameters<TestRunner['onAfterRunSuite']>[0],
      initializeResult: boolean,
    ): void {
      if (!('filepath' in suite) || typeof suite.filepath !== 'string') return
      const violations = store.unreported(suite.filepath)
      store.markReported(suite.filepath)
      if (violations.length === 0) return

      let result = suite.result
      if (!result) {
        if (!initializeResult) {
          throw new Error(violations.map((violation) => violation.message).join('\n'))
        }
        result = { state: 'fail', errors: [] }
        suite.result = result
      }
      if (!result.errors) result.errors = []
      result.errors.push({
        name: 'SharedDbScopeViolation',
        message: violations.map((violation) => violation.message).join('\n'),
      })
      result.state = 'fail'
    }
  }

  return SharedDbScopeGuardRunner as unknown as Base
}
