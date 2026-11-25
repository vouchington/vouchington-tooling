import {
  createSharedDbScopeObserver,
  sharedDbCursorScope,
  sharedDbIdsScope,
} from '@vouchington/postgres/query-telemetry'
import { TestRunner } from 'vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertGuardedDatabaseName,
  createSharedDbScopeGuard,
  createSharedDbScopeGuardRunner,
  getSharedDbScopeViolationStore,
  getSharedDbTransactionReservationStore,
  installSharedDbScopeObserver,
  sharedDbScopeTestIdentity,
} from './index.mts'

const uniqueDb = () => `test_db_${crypto.randomUUID().replaceAll('-', '_')}`

afterEach(() => {
  vi.restoreAllMocks()
})

describe('assertGuardedDatabaseName and installSharedDbScopeObserver', () => {
  it('rejects empty or whitespace database names and observer keys', () => {
    expect(() => assertGuardedDatabaseName('')).toThrow(RangeError)
    expect(() => assertGuardedDatabaseName('   ')).toThrow(RangeError)
    expect(assertGuardedDatabaseName('  app_test  ')).toBe('app_test')
    expect(() => installSharedDbScopeObserver('   ', () => {})).toThrow(RangeError)
  })

  it('installs, chains, and idempotently restores observers without clobbering replacements', () => {
    const db = uniqueDb()
    const key = `${db}.shared-db-scope-observer`
    const observer = createSharedDbScopeObserver({
      tables: { listOrders: 'orders' } as const,
      key,
    })
    const seenA: string[] = []
    const seenB: string[] = []
    const disposeA = installSharedDbScopeObserver(key, (event) => {
      seenA.push(event.operation)
    })
    const disposeB = installSharedDbScopeObserver(key, (event) => {
      seenB.push(event.operation)
    })

    observer.observe('listOrders', sharedDbIdsScope(['order-1']))
    expect(seenA).toEqual([])
    expect(seenB).toEqual(['listOrders'])

    // Disposing A while B is active must not overwrite B.
    disposeA()
    disposeA()
    observer.observe('listOrders', sharedDbIdsScope(['order-2']))
    expect(seenB).toEqual(['listOrders', 'listOrders'])

    // Disposing B restores A (previous when B installed).
    disposeB()
    observer.observe('listOrders', sharedDbIdsScope(['order-3']))
    expect(seenA).toEqual(['listOrders'])

    // Clean up global slot.
    observer.install(undefined)
  })
})

describe('createSharedDbScopeGuard', () => {
  it('namespaces state by database name and shares state across guard instances for the same database', () => {
    const dbA = uniqueDb()
    const dbB = uniqueDb()
    const guardA1 = createSharedDbScopeGuard({
      database: dbA,
      idsOnlyOperations: ['searchInbox'],
      requiredScopeDescription: (event) =>
        event.operation === 'searchInbox' ? 'fixture IDs or a proven owned keyset' : undefined,
    })
    const guardA2 = createSharedDbScopeGuard({ database: dbA })
    const guardB = createSharedDbScopeGuard({ database: dbB })

    const filepath = expect.getState().testPath!
    expect(guardA1.database).toBe(dbA)
    expect(guardA1.observerKey).toBe(`${dbA}.shared-db-scope-observer`)
    expect(guardA1.currentTestIdentity()).toContain(filepath)

    expect(() =>
      guardA1.rejectUnscopedCall({
        operation: 'searchInbox',
        table: 'inbox_items',
        scope: { kind: 'global' },
      }),
    ).toThrow(
      '[vitest-shared-db-scope] searchInbox on inbox_items requires fixture IDs or a proven owned keyset',
    )

    // Same database shares violations across separate guard instances; other database stays isolated.
    expect(guardA2.unreportedViolations(filepath)).toHaveLength(1)
    expect(guardB.unreportedViolations(filepath)).toHaveLength(0)

    guardA2.markViolationsReported(filepath)
    expect(guardA1.unreportedViolations(filepath)).toEqual([])
  })

  it('admits valid IDs, cursors on non-ids-only ops, and rejects empty or ids-only cursor scopes', () => {
    const db = uniqueDb()
    const guard = createSharedDbScopeGuard<string, string>({
      database: db,
      idsOnlyOperations: ['strictOp'],
      messagePrefix: '[custom-scope]',
    })
    const filepath = expect.getState().testPath!

    expect(() =>
      guard.rejectUnscopedCall({
        operation: 'flexOp',
        table: 'items',
        scope: sharedDbIdsScope(['id-1']),
      }),
    ).not.toThrow()
    expect(() =>
      guard.rejectUnscopedCall({
        operation: 'flexOp',
        table: 'items',
        scope: sharedDbCursorScope('cursor-1'),
      }),
    ).not.toThrow()
    expect(() =>
      guard.rejectUnscopedCall({
        operation: 'strictOp',
        table: 'items',
        scope: sharedDbIdsScope(['id-1']),
      }),
    ).not.toThrow()

    expect(() =>
      guard.rejectUnscopedCall({
        operation: 'strictOp',
        table: 'items',
        scope: sharedDbCursorScope('cursor-1'),
      }),
    ).toThrow('[custom-scope] strictOp on items requires fixture IDs')

    expect(() =>
      guard.rejectUnscopedCall({
        operation: 'flexOp',
        table: 'items',
        scope: { kind: 'ids', ids: [''] },
      }),
    ).toThrow('[custom-scope] flexOp on items requires fixture IDs or a real keyset cursor')

    expect(() =>
      guard.rejectUnscopedCall({
        operation: 'flexOp',
        table: 'items',
        scope: { kind: 'global' },
      }),
    ).toThrow('[custom-scope] flexOp on items requires fixture IDs or a real keyset cursor')

    expect(guard.unreportedViolations(filepath)).toHaveLength(3)
    guard.markViolationsReported(filepath)
  })

  it('installs its default observer and receives events from createSharedDbScopeObserver', () => {
    const db = uniqueDb()
    const guard = createSharedDbScopeGuard({ database: db })
    const scopeObserver = createSharedDbScopeObserver({
      tables: { listItems: 'items' } as const,
      key: guard.observerKey,
    })
    const dispose = guard.installObserver()
    const filepath = expect.getState().testPath!
    try {
      expect(() => scopeObserver.observe('listItems', { kind: 'global' })).toThrow(
        '[vitest-shared-db-scope] listItems on items requires fixture IDs or a real keyset cursor',
      )
      expect(() => scopeObserver.observe('listItems', sharedDbIdsScope(['item-1']))).not.toThrow()
    } finally {
      dispose()
      guard.markViolationsReported(filepath)
    }
  })

  it('admits reserved global transactions only for the active test, table, operation, and lifetime', () => {
    const db = uniqueDb()
    const guard = createSharedDbScopeGuard<string, string>({
      database: db,
      reservableOperations: [{ operation: 'cleanupCursors', table: 'cursor_table' }],
    })
    const tx = { id: 'tx-1' }
    const otherTx = { id: 'tx-2' }
    const filepath = expect.getState().testPath!

    const release = guard.registerTransactionReservation(tx)
    // Re-registering the same transaction fails.
    expect(() => guard.registerTransactionReservation(tx)).toThrow(
      'Shared DB transaction reservation requires one active test transaction',
    )

    const event = {
      operation: 'cleanupCursors',
      table: 'cursor_table',
      scope: { kind: 'global' } as const,
      transaction: tx as never,
    }
    expect(() => guard.rejectUnscopedCall(event)).not.toThrow()
    expect(() => guard.rejectUnscopedCall({ ...event, transaction: otherTx as never })).toThrow(
      'requires',
    )
    expect(() => guard.rejectUnscopedCall({ ...event, table: 'other_table' })).toThrow('requires')

    // Different test identity must not reuse the reservation.
    const originalState = expect.getState()
    vi.spyOn(expect, 'getState').mockReturnValue({
      ...originalState,
      currentTestName: 'some other test',
    })
    expect(() => guard.rejectUnscopedCall(event)).toThrow('requires')
    vi.restoreAllMocks()

    // Releasing is idempotent; afterward the reservation no longer admits.
    release()
    release()
    expect(() => guard.rejectUnscopedCall(event)).toThrow('requires')

    // Re-registering and having another release called after replacement does not delete the new entry.
    const reservations = getSharedDbTransactionReservationStore<object>(db)
    const release2 = reservations.register(tx)
    expect(reservations.get(tx)?.owner).toBe(sharedDbScopeTestIdentity())
    release2()
    expect(reservations.get(tx)).toBeUndefined()

    // Registering outside an active test throws.
    const { currentTestName: _omittedName, ...withoutTestName } = originalState
    vi.spyOn(expect, 'getState').mockReturnValue(withoutTestName)
    expect(sharedDbScopeTestIdentity()).toBe('')
    expect(() => guard.registerTransactionReservation(otherTx)).toThrow(
      'Shared DB transaction reservation requires one active test transaction',
    )
    vi.restoreAllMocks()

    guard.markViolationsReported(filepath)
  })

  it('evaluates custom policies and records both Error and non-Error policy failures', () => {
    const db = uniqueDb()
    let mode: 'admit' | 'skip' | 'throw-error' | 'throw-string' = 'admit'
    const guard = createSharedDbScopeGuard({
      database: db,
      policies: [
        {
          observe: () => {
            if (mode === 'admit') return true
            if (mode === 'skip') return false
            if (mode === 'throw-error') throw new Error('policy denied')
            // oxlint-disable-next-line no-throw-literal -- test non-Error throw formatting branch
            throw 'string policy failure'
          },
        },
      ],
    })
    const filepath = expect.getState().testPath!
    const event = {
      operation: 'searchRows',
      table: 'rows',
      scope: { kind: 'global' } as const,
    }

    expect(() => guard.rejectUnscopedCall(event)).not.toThrow()

    mode = 'throw-error'
    expect(() => guard.rejectUnscopedCall(event)).toThrow('policy denied')

    mode = 'throw-string'
    expect(() => guard.rejectUnscopedCall(event)).toThrow('string policy failure')

    mode = 'skip'
    expect(() => guard.rejectUnscopedCall(event)).toThrow('requires')

    const recorded = guard.unreportedViolations(filepath)
    expect(recorded.map((item) => item.message)).toEqual([
      '[vitest-shared-db-scope] policy denied',
      '[vitest-shared-db-scope] string policy failure',
      '[vitest-shared-db-scope] searchRows on rows requires fixture IDs or a real keyset cursor',
    ])
    guard.markViolationsReported(filepath)
  })

  it('throws when recording a violation without an active testPath', () => {
    const db = uniqueDb()
    const guard = createSharedDbScopeGuard({ database: db })
    const originalState = expect.getState()
    const { testPath: _omittedPath, ...withoutTestPath } = originalState
    vi.spyOn(expect, 'getState').mockReturnValue(withoutTestPath)
    expect(() =>
      guard.recordViolation({ operation: 'op', table: 'tbl', scope: { kind: 'global' } }, 'boom'),
    ).toThrow('Shared DB scope violation has no active test file: boom')
  })
})

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

    // Default baseRunner (Vitest TestRunner) constructs cleanly.
    const DefaultRunner = createSharedDbScopeGuardRunner({ database: db })
    expect(Object.getPrototypeOf(DefaultRunner)).toBe(TestRunner)
  })
})
