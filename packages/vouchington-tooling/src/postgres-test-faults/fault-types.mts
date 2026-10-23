import type pg from 'pg'

/** Minimal structural query executor: a `pg.Pool#query`, a pool client, or a wrapper around one. */
export type QueryExecutor = <Row extends object = Record<string, unknown>>(query: {
  text: string
  values?: unknown[]
}) => Promise<{ rows: Row[] }>

/** Statement kinds a fault can target after the leading marker annotation. */
export type FaultCommand = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

export type PostgresFaultOptions = {
  /** Pools whose connections are instrumented while the operation runs. */
  pools: readonly pg.Pool[]
  /** Only fail a statement whose SQL, after the marker, starts with this command. */
  command?: FaultCommand
  /** Own faults raised outside the async context of the operation, for example in a request handler. */
  requestId?: string
  /** Decides whether the current execution context belongs to `requestId`. Required with `requestId`. */
  isOwnedRequest?: (requestId: string) => boolean
  /** Milliseconds to wait for a failed pool client to finish closing. Defaults to 5000. */
  endTimeoutMs?: number
}

export type PostgresFaultResult<Result> = { result: Result; error: Error }

export type PollOptions = {
  /** Milliseconds before an observer gives up. Defaults to 5000. */
  timeoutMs?: number
  /** Milliseconds between observations. Defaults to 10. */
  intervalMs?: number
}

export type ObserverPool = 'write' | 'advisoryLock' | QueryExecutor

export type LockObserverConfig = PollOptions & {
  /** Executor for the default `'write'` observer and for advisory-lock holder lookups. */
  write: QueryExecutor
  /** Executor for the `'advisoryLock'` observer, usually a pool reserved for observation. */
  advisoryLockPool?: QueryExecutor
}

export type LockWaiterDiagnostic = {
  phase: 'snapshot-clear-start' | 'snapshot-cleared' | 'waiter-query-start' | 'waiter-query'
  waiting: boolean
}
