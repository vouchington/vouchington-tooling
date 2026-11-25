import type { SharedDbKeysetRead, SharedDbScopeEvent } from '@vouchington/postgres/query-telemetry'
import { assertGuardedDatabaseName } from './violations-store.mts'

export type OwnedKeysetFixture = {
  actorId: string
  id: string
  timestamp: string
  afterId: string
}

/** Standard start/completed keyset read payload shape validated by `OwnedKeysetReadPolicy`. */
export type SharedDbOwnedKeysetRead = SharedDbKeysetRead<
  {
    actorId: string
    after: { timestamp: unknown; id: unknown } | undefined
    limit: number
    sqlLimit: unknown
  },
  { rowCount: number; first: { id: string; timestamp: string } | undefined }
>

export interface OwnedKeysetReadPolicyTarget<
  Operation extends string = string,
  Table extends string = string,
> {
  operation: Operation
  table: Table
  /** Expected logical page size. Defaults to `1`. */
  limit?: number
  /** Expected SQL fetch limit (`limit + 1`). Defaults to `limit + 1`. */
  sqlLimit?: number
}

type ReadEntry<Operation extends string, Table extends string> = {
  event: SharedDbScopeEvent<Operation, Table, SharedDbOwnedKeysetRead>
  completed: boolean
}

type Registration<Operation extends string, Table extends string> = {
  owner: string
  fixture: OwnedKeysetFixture
  reads: Map<symbol, ReadEntry<Operation, Table>>
  reportFailure: (
    event: SharedDbScopeEvent<Operation, Table, SharedDbOwnedKeysetRead>,
    message: string,
  ) => void
}

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

/** True when `after` and `id` are valid UUIDs and `BigInt(after) + 1n === BigInt(id)`. */
export function isImmediateUuidPredecessor(after: string, id: string): boolean {
  return (
    UUID_PATTERN.test(after) &&
    UUID_PATTERN.test(id) &&
    BigInt(`0x${after.replaceAll('-', '')}`) + 1n === BigInt(`0x${id.replaceAll('-', '')}`)
  )
}

/**
 * Admits a keyset read only provisionally on `start`; the `completed` event must prove that the
 * committed first row belongs to the registered test fixture.
 */
export class OwnedKeysetReadPolicy<
  Operation extends string = string,
  Table extends string = string,
> {
  private readonly operation: Operation
  private readonly table: Table
  private readonly limit: number
  private readonly sqlLimit: number
  private readonly registrations = new Set<Registration<Operation, Table>>()

  constructor(target: OwnedKeysetReadPolicyTarget<Operation, Table>) {
    this.operation = target.operation
    this.table = target.table
    this.limit = target.limit ?? 1
    this.sqlLimit = target.sqlLimit ?? this.limit + 1
  }

  register(
    owner: string,
    fixture: OwnedKeysetFixture,
    reportFailure: Registration<Operation, Table>['reportFailure'],
  ): () => void {
    if (!owner || !isImmediateUuidPredecessor(fixture.afterId, fixture.id)) {
      throw new Error('An owned keyset requires an active test and its immediate UUID predecessor')
    }
    const registration: Registration<Operation, Table> = {
      owner,
      fixture,
      reads: new Map(),
      reportFailure,
    }
    this.registrations.add(registration)
    return () => {
      if (!this.registrations.delete(registration)) return
      const unfinished = [...registration.reads.values()].filter((read) => !read.completed)
      for (const { event } of unfinished) {
        reportFailure(
          event,
          'Owned keyset read did not complete with its committed owned first row',
        )
      }
      if (unfinished.length > 0) throw new Error('Owned keyset read did not complete')
    }
  }

  observe(
    event: SharedDbScopeEvent<Operation, Table, SharedDbOwnedKeysetRead>,
    owner: string,
  ): boolean {
    if (
      event.operation !== this.operation ||
      event.table !== this.table ||
      event.scope.kind !== 'global' ||
      !event.keysetRead
    ) {
      return false
    }
    const read = event.keysetRead
    if (read.phase === 'start') {
      const registration = [...this.registrations].find(
        ({ owner: registeredOwner, fixture }) =>
          registeredOwner === owner &&
          fixture.actorId === read.actorId &&
          fixture.timestamp === read.after?.timestamp &&
          fixture.afterId === read.after.id,
      )
      if (!registration || read.limit !== this.limit || read.sqlLimit !== this.sqlLimit) {
        return false
      }
      if ([...this.registrations].some((entry) => entry.reads.has(read.identity))) {
        throw new Error('Owned keyset query identity was reused')
      }
      registration.reads.set(read.identity, { event, completed: false })
      return true
    }
    const registration = [...this.registrations].find(
      (entry) => entry.owner === owner && entry.reads.has(read.identity),
    )
    if (!registration) throw new Error('Owned keyset completion has no matching admission')
    const admitted = registration.reads.get(read.identity)!
    if (admitted.completed) throw new Error('Owned keyset query completed twice')
    if (
      !Number.isInteger(read.rowCount) ||
      read.rowCount < 1 ||
      read.rowCount > this.sqlLimit ||
      read.first?.id !== registration.fixture.id ||
      read.first.timestamp !== registration.fixture.timestamp
    ) {
      throw new Error('Committed keyset result did not prove its owned first row and bound')
    }
    admitted.completed = true
    return true
  }
}

export interface SharedOwnedKeysetReadPolicyOptions<
  Operation extends string = string,
  Table extends string = string,
> extends OwnedKeysetReadPolicyTarget<Operation, Table> {
  /** Logical name of the guarded database used to namespace the process-global policy registry. */
  database: string
  /** Optional explicit `Symbol.for(...)` key. Defaults to `${database}.vitest-owned-keyset-read-policy`. */
  policyKey?: string
}

/**
 * Returns the process-global `OwnedKeysetReadPolicy` for `options.database`, preserving
 * registrations across Vitest module resets.
 */
export function getSharedOwnedKeysetReadPolicy<
  Operation extends string = string,
  Table extends string = string,
>(
  options: SharedOwnedKeysetReadPolicyOptions<Operation, Table>,
): OwnedKeysetReadPolicy<Operation, Table> {
  const database = assertGuardedDatabaseName(options.database)
  const key = options.policyKey ?? `${database}.vitest-owned-keyset-read-policy`
  if (key.trim().length === 0) {
    throw new RangeError('Owned keyset policy key must be a non-empty string')
  }
  const symbol = Symbol.for(key)
  const host = globalThis as unknown as Record<
    symbol,
    OwnedKeysetReadPolicy<Operation, Table> | undefined
  >
  const existing = host[symbol]
  if (existing) return existing
  const policy = new OwnedKeysetReadPolicy<Operation, Table>(options)
  host[symbol] = policy
  return policy
}
