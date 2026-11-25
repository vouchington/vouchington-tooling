import {
  createSharedDbScopeObserver,
  sharedDbCursorScope,
  sharedDbIdsScope,
} from '@vouchington/postgres/query-telemetry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertGuardedDatabaseName,
  createSharedDbScopeGuard,
  getSharedDbTransactionReservationStore,
  installSharedDbScopeObserver,
  OwnedKeysetReadPolicy,
  sharedDbScopeTestIdentity,
  type SharedDbOwnedKeysetRead,
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

  it('installs, chains, and disposes observers without resurrecting disposed or clobbering duplicates', () => {
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

    // Out-of-order: disposing A while B is active keeps B; later disposing B restores empty (not A).
    disposeA()
    disposeA()
    observer.observe('listOrders', sharedDbIdsScope(['order-2']))
    expect(seenB).toEqual(['listOrders', 'listOrders'])

    disposeB()
    observer.observe('listOrders', sharedDbIdsScope(['order-3']))
    expect(seenA).toEqual([])
    expect(seenB).toEqual(['listOrders', 'listOrders'])

    // Installing the same callback twice gives distinct identities; LIFO restores the remaining one.
    const sharedSeen: string[] = []
    const sharedCb = (event: { operation: string }) => {
      sharedSeen.push(event.operation)
    }
    const disposeFirst = installSharedDbScopeObserver(key, sharedCb)
    const disposeSecond = installSharedDbScopeObserver(key, sharedCb)
    disposeFirst()
    observer.observe('listOrders', sharedDbIdsScope(['order-4']))
    expect(sharedSeen).toEqual(['listOrders'])
    disposeSecond()
    observer.observe('listOrders', sharedDbIdsScope(['order-5']))
    expect(sharedSeen).toEqual(['listOrders'])

    // LIFO disposal restores the active predecessor; external replacement is preserved.
    const disposeOuter = installSharedDbScopeObserver(key, (event) => {
      seenA.push(event.operation)
    })
    const disposeInner = installSharedDbScopeObserver(key, (event) => {
      seenB.push(event.operation)
    })
    disposeInner()
    observer.observe('listOrders', sharedDbIdsScope(['order-6']))
    expect(seenA).toEqual(['listOrders'])
    observer.install(() => {})
    disposeOuter()
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

    // Calling the stale release while a replacement is registered does not delete the new entry.
    const reservations = getSharedDbTransactionReservationStore<object>(db)
    const release2 = reservations.register(tx)
    release()
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

  it('routes owned-keyset completions directly to the admitting policy when multiple policies share an operation', () => {
    const db = uniqueDb()
    const policyOne = new OwnedKeysetReadPolicy({
      operation: 'searchRows',
      table: 'rows',
      limit: 1,
    })
    const policyTwo = new OwnedKeysetReadPolicy({
      operation: 'searchRows',
      table: 'rows',
      limit: 2,
    })
    const guard = createSharedDbScopeGuard<string, string, SharedDbOwnedKeysetRead>({
      database: db,
      policies: [policyOne, policyTwo],
    })
    const fixture = {
      actorId: 'actor-1',
      id: '019c64e6-f710-7000-8000-000000000002',
      afterId: '019c64e6-f710-7000-8000-000000000001',
      timestamp: '2026-01-01T00:00:00.000000Z',
    }
    const close = policyTwo.register(guard.currentTestIdentity(), fixture, () => {})
    const id = Symbol('size-2')
    const filepath = expect.getState().testPath!
    try {
      guard.rejectUnscopedCall({
        operation: 'searchRows',
        table: 'rows',
        scope: { kind: 'global' },
        keysetRead: {
          phase: 'start',
          identity: id,
          actorId: fixture.actorId,
          after: { timestamp: fixture.timestamp, id: fixture.afterId },
          limit: 2,
          sqlLimit: 3,
        },
      })
      guard.rejectUnscopedCall({
        operation: 'searchRows',
        table: 'rows',
        scope: { kind: 'global' },
        keysetRead: {
          phase: 'completed',
          identity: id,
          rowCount: 2,
          first: { id: fixture.id, timestamp: fixture.timestamp },
        },
      })
      expect(() =>
        guard.rejectUnscopedCall({
          operation: 'searchRows',
          table: 'rows',
          scope: { kind: 'global' },
          keysetRead: {
            phase: 'completed',
            identity: id,
            rowCount: 2,
            first: { id: fixture.id, timestamp: fixture.timestamp },
          },
        }),
      ).toThrow('Owned keyset query completed twice')
    } finally {
      close()
      guard.markViolationsReported(filepath)
    }
  })
})
