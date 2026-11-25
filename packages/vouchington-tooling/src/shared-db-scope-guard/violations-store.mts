import { expect } from 'vitest'

export type SharedDbScopeViolation<Event = unknown> = {
  event: Event
  message: string
  filepath: string
}

type GlobalHost = Record<symbol, unknown>

/** Validates a non-empty guarded database name used to namespace process-global guard state. */
export function assertGuardedDatabaseName(database: string): string {
  const trimmed = database.trim()
  if (trimmed.length === 0) {
    throw new RangeError('Guarded database name must be a non-empty string')
  }
  return trimmed
}

/** Identifies the currently running Vitest test (`<filepath>:<testName>`) or returns `''`. */
export function sharedDbScopeTestIdentity(): string {
  const { testPath, currentTestName } = expect.getState()
  return testPath && currentTestName ? `${testPath}:${currentTestName}` : ''
}

export interface SharedDbScopeViolationStore<Event = unknown> {
  unreported(filepath: string): readonly SharedDbScopeViolation<unknown>[]
  markReported(filepath: string): void
  record(event: Event, message: string): void
}

/** Returns the process-global violation store namespaced by the guarded database name. */
export function getSharedDbScopeViolationStore<Event = unknown>(
  database: string,
): SharedDbScopeViolationStore<Event> {
  const name = assertGuardedDatabaseName(database)
  const violationsKey = Symbol.for(`${name}.vitest-shared-db-scope-violations`)
  const reportedKey = Symbol.for(`${name}.vitest-shared-db-scope-reported`)

  const violations = (): SharedDbScopeViolation<unknown>[] => {
    const host = globalThis as unknown as GlobalHost
    const existing = host[violationsKey] as SharedDbScopeViolation<unknown>[] | undefined
    if (existing) return existing
    const created: SharedDbScopeViolation<unknown>[] = []
    host[violationsKey] = created
    return created
  }

  const reportedCounts = (): Map<string, number> => {
    const host = globalThis as unknown as GlobalHost
    const existing = host[reportedKey] as Map<string, number> | undefined
    if (existing) return existing
    const created = new Map<string, number>()
    host[reportedKey] = created
    return created
  }

  return {
    unreported(filepath: string): readonly SharedDbScopeViolation<unknown>[] {
      return violations()
        .filter((violation) => violation.filepath === filepath)
        .slice(reportedCounts().get(filepath) ?? 0)
    },
    markReported(filepath: string): void {
      const count = violations().filter((violation) => violation.filepath === filepath).length
      reportedCounts().set(filepath, count)
    },
    record(event: Event, message: string): void {
      const filepath = expect.getState().testPath
      if (!filepath) {
        throw new Error(`Shared DB scope violation has no active test file: ${message}`)
      }
      violations().push({ event, message, filepath })
    },
  }
}

export interface SharedDbTransactionReservationStore<Transaction extends object = object> {
  register(transaction: Transaction): () => void
  get(transaction: Transaction): { owner: string } | undefined
}

/** Returns the process-global transaction reservation registry namespaced by the guarded database. */
export function getSharedDbTransactionReservationStore<Transaction extends object = object>(
  database: string,
): SharedDbTransactionReservationStore<Transaction> {
  const name = assertGuardedDatabaseName(database)
  const reservationKey = Symbol.for(`${name}.vitest-shared-db-scope-reservations`)
  const host = globalThis as unknown as GlobalHost
  const existing = host[reservationKey] as WeakMap<Transaction, { owner: string }> | undefined
  const reservations = existing ?? new WeakMap<Transaction, { owner: string }>()
  if (!existing) host[reservationKey] = reservations

  return {
    register(transaction: Transaction): () => void {
      const owner = sharedDbScopeTestIdentity()
      if (!owner || reservations.has(transaction)) {
        throw new Error('Shared DB transaction reservation requires one active test transaction')
      }
      reservations.set(transaction, { owner })
      let closed = false
      return () => {
        if (closed) return
        closed = true
        reservations.delete(transaction)
      }
    },
    get(transaction: Transaction): { owner: string } | undefined {
      return reservations.get(transaction)
    },
  }
}
