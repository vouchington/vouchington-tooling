import { TestRunner, describe, expect, it } from 'vitest'
import { createSharedDbScopeGuardRunner, getSharedDbScopeViolationStore } from './index.mts'

const uniqueDb = () => `test_db_${crypto.randomUUID().replaceAll('-', '_')}`

describe('createSharedDbScopeGuardRunner', () => {
  it('augments importFile failures and reports suite violations on before/after hooks', async () => {
    const db = uniqueDb()
    const store = getSharedDbScopeViolationStore(db)
    const filepath = expect.getState().testPath!

    class FakeBaseRunner {
      importError: unknown
      async importFile(_filepath: string, _source: string): Promise<void> {
        if (this.importError !== undefined) throw this.importError
      }
      async onBeforeRunSuite(_suite: unknown): Promise<void> {}
      async onAfterRunSuite(_suite: unknown): Promise<void> {}
    }

    const RunnerClass = createSharedDbScopeGuardRunner({
      database: db,
      baseRunner: FakeBaseRunner as unknown as typeof TestRunner,
    })
    const runner = new RunnerClass({} as never) as unknown as FakeBaseRunner & {
      importFile(filepath: string, source: 'collect' | 'setup'): Promise<void>
      onBeforeRunSuite(suite: Record<string, unknown>): Promise<void>
      onAfterRunSuite(suite: Record<string, unknown>): Promise<void>
    }

    // importFile with no error succeeds.
    await expect(runner.importFile(filepath, 'collect')).resolves.toBeUndefined()

    // importFile with error and no violations rethrows original error.
    const plainError = new Error('syntax error')
    runner.importError = plainError
    await expect(runner.importFile(filepath, 'collect')).rejects.toBe(plainError)

    // importFile with Error + recorded violation wraps both.
    store.record({ op: 'a' }, '[vitest-shared-db-scope] leaked during import')
    await expect(runner.importFile(filepath, 'collect')).rejects.toThrow(
      'syntax error\n\n[vitest-shared-db-scope] leaked during import',
    )

    // importFile with non-Error + recorded violation stringifies it.
    runner.importError = 'non-error import failure'
    store.record({ op: 'b' }, '[vitest-shared-db-scope] leaked non-error')
    await expect(runner.importFile(filepath, 'collect')).rejects.toThrow(
      'non-error import failure\n\n[vitest-shared-db-scope] leaked non-error',
    )
    runner.importError = undefined

    // Suite without filepath is ignored.
    await expect(runner.onAfterRunSuite({})).resolves.toBeUndefined()

    // onBeforeRunSuite ignores non-failed suites, reports failed suites.
    store.record({ op: 'c' }, '[vitest-shared-db-scope] failed setup')
    const passingSuite = { filepath, result: { state: 'pass' } }
    await runner.onBeforeRunSuite(passingSuite)
    expect(passingSuite.result.state).toBe('pass')

    const failedSuite: { filepath: string; result: { state: string; errors?: unknown[] } } = {
      filepath,
      result: { state: 'fail' },
    }
    await runner.onBeforeRunSuite(failedSuite)
    expect(failedSuite.result.errors).toEqual([
      {
        name: 'SharedDbScopeViolation',
        message: '[vitest-shared-db-scope] failed setup',
      },
    ])

    // Already reported -> no duplicate onAfterRunSuite error.
    await runner.onAfterRunSuite(failedSuite)
    expect(failedSuite.result.errors).toHaveLength(1)

    // Suite with existing errors array appends to it.
    store.record({ op: 'd' }, '[vitest-shared-db-scope] caught in test')
    const existingErrorsSuite = {
      filepath,
      result: { state: 'pass', errors: [{ name: 'Other', message: 'prior' }] },
    }
    await runner.onAfterRunSuite(existingErrorsSuite)
    expect(existingErrorsSuite.result.state).toBe('fail')
    expect(existingErrorsSuite.result.errors).toHaveLength(2)

    // Suite without result throws directly.
    store.record({ op: 'e' }, '[vitest-shared-db-scope] no result object')
    await expect(runner.onAfterRunSuite({ filepath })).rejects.toThrow(
      '[vitest-shared-db-scope] no result object',
    )

    // Skipped/todo suites with no violations stay untouched; those with import-time violations fail.
    const cleanSkippedSuite: Record<string, unknown> = { filepath, mode: 'skip' }
    await runner.onBeforeRunSuite(cleanSkippedSuite)
    expect(cleanSkippedSuite.result).toBeUndefined()

    store.record({ op: 'skip-viol' }, '[vitest-shared-db-scope] leaked before skip')
    const dirtyTodoSuite: {
      filepath: string
      mode: string
      result?: { state: string; errors?: unknown[] }
    } = {
      filepath,
      mode: 'todo',
    }
    await runner.onBeforeRunSuite(dirtyTodoSuite)
    expect(dirtyTodoSuite.result?.state).toBe('fail')
    expect(dirtyTodoSuite.result?.errors).toEqual([
      {
        name: 'SharedDbScopeViolation',
        message: '[vitest-shared-db-scope] leaked before skip',
      },
    ])

    // Default baseRunner (Vitest TestRunner) constructs cleanly.
    const DefaultRunner = createSharedDbScopeGuardRunner({ database: db })
    expect(Object.getPrototypeOf(DefaultRunner)).toBe(TestRunner)
  })
})
