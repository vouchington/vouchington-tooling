import type {
  SharedDbKeysetRead,
  SharedDbScopeEvent,
  SharedDbScopeObserver,
} from '@vouchington/postgres/query-telemetry'
import { installSharedDbScopeObserver } from './observer.mts'
import {
  assertGuardedDatabaseName,
  getSharedDbScopeViolationStore,
  getSharedDbTransactionReservationStore,
  sharedDbScopeTestIdentity,
  type SharedDbScopeViolation,
} from './violations-store.mts'

export interface SharedDbScopePolicy<
  Operation extends string = string,
  Table extends string = string,
  KeysetRead extends SharedDbKeysetRead = SharedDbKeysetRead,
> {
  observe(event: SharedDbScopeEvent<Operation, Table, KeysetRead>, owner: string): boolean
}

export interface SharedDbScopeGuardOptions<
  Operation extends string = string,
  Table extends string = string,
  KeysetRead extends SharedDbKeysetRead = SharedDbKeysetRead,
> {
  /**
   * Logical name of the guarded database. Used to namespace process-global registries so separate
   * module graphs share state for the same database without colliding across databases.
   */
  database: string
  /**
   * `Symbol.for(...)` registry key shared with `createSharedDbScopeObserver({ key })`.
   * Defaults to `${database}.shared-db-scope-observer`.
   */
  observerKey?: string
  /** Operations that require fixture IDs rather than a keyset cursor alone. */
  idsOnlyOperations?: ReadonlySet<Operation> | readonly Operation[]
  /** Operation/table pairs allowed with `global` scope on an explicitly reserved transaction. */
  reservableOperations?: ReadonlyArray<{ operation: Operation; table: Table }>
  /** Additional scope admission policies evaluated when standard scope checks do not admit. */
  policies?: ReadonlyArray<SharedDbScopePolicy<Operation, Table, KeysetRead>>
  /** Optional custom description for the required scope in violation messages. */
  requiredScopeDescription?: (
    event: SharedDbScopeEvent<Operation, Table, KeysetRead>,
  ) => string | undefined
  /** Prefix prepended to violation messages. Defaults to `'[vitest-shared-db-scope]'`. */
  messagePrefix?: string
}

export interface SharedDbScopeGuard<
  Operation extends string = string,
  Table extends string = string,
  KeysetRead extends SharedDbKeysetRead = SharedDbKeysetRead,
  Transaction extends object = object,
> {
  readonly database: string
  readonly observerKey: string
  installObserver(observer?: SharedDbScopeObserver<Operation, Table, KeysetRead>): () => void
  rejectUnscopedCall(event: SharedDbScopeEvent<Operation, Table, KeysetRead>): void
  recordViolation(event: SharedDbScopeEvent<Operation, Table, KeysetRead>, message: string): void
  unreportedViolations(filepath: string): readonly SharedDbScopeViolation<unknown>[]
  markViolationsReported(filepath: string): void
  currentTestIdentity(): string
  registerTransactionReservation(transaction: Transaction): () => void
}

/**
 * Builds a database-namespaced shared-DB scope guard for Vitest suites. State lives on
 * `globalThis` under symbols derived from `options.database` so it survives `vi.resetModules()`.
 */
export function createSharedDbScopeGuard<
  Operation extends string = string,
  Table extends string = string,
  KeysetRead extends SharedDbKeysetRead = SharedDbKeysetRead,
  Transaction extends object = object,
>(
  options: SharedDbScopeGuardOptions<Operation, Table, KeysetRead>,
): SharedDbScopeGuard<Operation, Table, KeysetRead, Transaction> {
  const database = assertGuardedDatabaseName(options.database)
  const observerKey = options.observerKey ?? `${database}.shared-db-scope-observer`
  const messagePrefix = options.messagePrefix ?? '[vitest-shared-db-scope]'
  const idsOnly = new Set<Operation>(options.idsOnlyOperations ?? [])
  const reservable = options.reservableOperations ?? []
  const policies = options.policies ?? []
  const admittedKeysetPolicies = new Map<
    symbol,
    SharedDbScopePolicy<Operation, Table, KeysetRead>
  >()
  const store =
    getSharedDbScopeViolationStore<SharedDbScopeEvent<Operation, Table, KeysetRead>>(database)
  const reservations = getSharedDbTransactionReservationStore<Transaction>(database)

  const rejectUnscopedCall = (event: SharedDbScopeEvent<Operation, Table, KeysetRead>): void => {
    const owner = sharedDbScopeTestIdentity()
    const reservation = event.transaction
      ? reservations.get(event.transaction as unknown as Transaction)
      : undefined
    if (
      event.scope.kind === 'global' &&
      reservation &&
      owner &&
      reservation.owner === owner &&
      reservable.some((entry) => entry.operation === event.operation && entry.table === event.table)
    ) {
      return
    }

    const requiresIds = idsOnly.has(event.operation)
    const scope = event.scope
    if (
      (scope.kind === 'ids' && scope.ids.length > 0 && scope.ids.every((id) => id.length > 0)) ||
      (!requiresIds && scope.kind === 'cursor' && scope.id.length > 0)
    ) {
      return
    }

    const keysetRead = event.keysetRead
    const admittedPolicy =
      keysetRead?.phase === 'completed'
        ? admittedKeysetPolicies.get(keysetRead.identity)
        : undefined
    const candidatePolicies = admittedPolicy ? [admittedPolicy] : policies
    for (const policy of candidatePolicies) {
      try {
        if (policy.observe(event, owner)) {
          if (keysetRead?.phase === 'start') {
            admittedKeysetPolicies.set(keysetRead.identity, policy)
          }
          return
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        store.record(event, `${messagePrefix} ${detail}`)
        throw err
      }
    }

    const requiredScope =
      options.requiredScopeDescription?.(event) ??
      (requiresIds ? 'fixture IDs' : 'fixture IDs or a real keyset cursor')
    const message = `${messagePrefix} ${event.operation} on ${event.table} requires ${requiredScope}`
    store.record(event, message)
    throw new Error(message)
  }

  return {
    database,
    observerKey,
    installObserver(observer = rejectUnscopedCall) {
      return installSharedDbScopeObserver(observerKey, observer)
    },
    rejectUnscopedCall,
    recordViolation(event, message) {
      store.record(event, message)
    },
    unreportedViolations(filepath) {
      return store.unreported(filepath)
    },
    markViolationsReported(filepath) {
      store.markReported(filepath)
    },
    currentTestIdentity: sharedDbScopeTestIdentity,
    registerTransactionReservation(transaction) {
      return reservations.register(transaction)
    },
  }
}
