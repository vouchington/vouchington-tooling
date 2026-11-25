export { withPostgresPoolQueryFailureForTest } from './pool-query-failure.mts'
export { withPostgresQueryFailureForTest } from './query-failure.mts'
/**
 * Runs `operation` while holding the package-wide queue that serializes `pg.Pool` instrumentation.
 * `withPostgresQueryFailureForTest` and `withPostgresPoolQueryFailureForTest` already use it, so
 * their scopes never wrap the same pool at once. Wrap your own fault injection or lock observation
 * in it when it patches or watches a pool and may overlap those helpers. Callers wait their turn in
 * arrival order; the next one starts when `operation` settles, even if it rejects. Calling it from
 * inside `operation` (nesting) rejects instead of deadlocking.
 */
export { runPoolObservationExclusively } from './observation-queue.mts'
export { createPostgresLockObservers, type PostgresLockObservers } from './lock-observers.mts'
export { getTestPostgresBackendProcessId, testBlockedBackendHoldsRelation } from './lock-wait.mts'
export {
  acquireTestPostgresAdvisoryLock,
  type AcquireTestPostgresAdvisoryLockOptions,
  type TestPostgresAdvisoryLock,
} from './advisory-lock.mts'
export {
  createTestPostgresLockWaiter,
  type CreateTestPostgresLockWaiterOptions,
  type TestLockWaiterHeldLock,
  type TestLockWaiterHolder,
} from './borrowed-lock-waiter.mts'
export {
  createTestPostgresConnectionWaitPool,
  type PostgresConnectionWaitPoolOptions,
  type TestPostgresConnectionWaitPool,
} from './connection-wait.mts'
export {
  getPublicBaseTableNamesForTest,
  installPsqlPoolSocketTracking,
  readTestDatabaseTimestamp,
  registerPsqlPoolMetrics,
  type PsqlPoolMetric,
  type PsqlPoolSocketHandles,
} from './database-utilities.mts'
export {
  observeTestPostgresLockQuery,
  type TestPostgresLockQuery,
  type TestPostgresLockQueryObservation,
} from './lock-query-observation.mts'
export {
  answerPostgresReadsForTest,
  answerPostgresWritesForTest,
  observePostgresWritesForTest,
  rejectNextPostgresTransactionForTest,
  rejectPostgresReadForTest,
  rejectPostgresWriteForTest,
  runAfterPostgresWriteForTest,
  type PoolQueryMethod,
  type ReadQueryTarget,
  type WriteQueryTarget,
} from './query-interception.mts'
export { clientQueryText, tapClientQueries, type ObservedClientQuery } from './client-query-tap.mts'
export {
  observeTestPostgresClientQueries,
  observeTestPostgresQueryPools,
} from './query-pool-observer.mts'
export {
  observePostgresReadRoutingForTest,
  type PostgresReadRoutingObserver,
} from './read-routing.mts'
export {
  extractSqlStatement,
  rejectQuery,
  withFailingTransactionQueryOptionsForTest,
  withForcedTransactionRollbackForTest,
  withRejectedPostgresQueryForTest,
  type CallableSqlQueryExecutor,
  type ManagedSqlTransaction,
  type SqlQueryResult,
  type SqlStatementInput,
  type TransactionBeginTarget,
} from './executor-faults.mts'
export {
  afterNextPostgresCommitForTest,
  afterPostgresTransactionQueryForTest,
  beforePostgresTransactionQueryForTest,
  interceptPostgresTransactionQueriesForTest,
  interceptPostgresTransactionsForTest,
  rewritePostgresTransactionRowsForTest,
} from './transaction-interception.mts'
export type {
  FaultCommand,
  LockObserverConfig,
  LockWaiterDiagnostic,
  ObserverPool,
  PollOptions,
  PostgresFaultOptions,
  PostgresFaultResult,
  QueryExecutor,
} from './fault-types.mts'
export { abortTestPostgresTransaction } from './aborted-transaction.mts'
export {
  createTestPostgresClientLoan,
  discardTestPostgresClient,
  reserveTestPostgresObserver,
  trackTestPostgresClientEnd,
} from './client-loan.mts'
export {
  assertTestOwnedPostgresWait,
  getTestOwnedPostgresLock,
  type TestHeldPostgresLock,
  type TestOwnedPostgresWaitOptions,
  type TestPostgresLockIdentity,
} from './lock-identity.mts'
export {
  observePostgresLockNotice,
  observeTestAdvisoryLockNotice,
  observeTestTransactionLockNotice,
  type LockNoticeClient,
  type LockNoticeObservation,
  type LockNoticeOptions,
} from './lock-notice.mts'
export { createTestPostgresMultiWait, type TestPostgresMultiWaitAction } from './multi-wait.mts'
export { withTestOwnedPostgresWait } from './owned-wait.mts'
