---
'vouchington-tooling': minor
---

Add the test-only `vouchington-tooling/shared-db-scope-guard` subpath and extend `vouchington-tooling/postgres-test-faults` with generic PostgreSQL fault-injection, lock-wait, query-observation, read-routing, and pool-metrics test helpers.

New subpath `vouchington-tooling/shared-db-scope-guard`:

- `createSharedDbScopeGuard`, `createSharedDbScopeGuardRunner`, `installSharedDbScopeObserver`
- `OwnedKeysetReadPolicy`, `getSharedOwnedKeysetReadPolicy`, `isImmediateUuidPredecessor`
- `assertGuardedDatabaseName`, `getSharedDbScopeViolationStore`, `getSharedDbTransactionReservationStore`, `sharedDbScopeTestIdentity`
- `configureTestPostgresSessions`, `parseTestStatementTimeout`, `FAST_TEST_STATEMENT_TIMEOUT_MS`, `MIN_TEST_STATEMENT_TIMEOUT_MS`, `MAX_TEST_STATEMENT_TIMEOUT_MS`

New exports on `vouchington-tooling/postgres-test-faults`:

- `acquireTestPostgresAdvisoryLock`, `observeTestPostgresLockQuery`, `createTestPostgresLockWaiter`, `testBlockedBackendHoldsRelation`
- `clientQueryText`, `tapClientQueries`, `observeTestPostgresQueryPools`, `observeTestPostgresClientQueries`, `observePostgresReadRoutingForTest`, `createTestPostgresConnectionWaitPool`
- `extractSqlStatement`, `rejectQuery`, `withRejectedPostgresQueryForTest`, `withForcedTransactionRollbackForTest`, `withFailingTransactionQueryOptionsForTest`
- `interceptPostgresTransactionsForTest`, `rewritePostgresTransactionRowsForTest`, `afterNextPostgresCommitForTest`, `afterPostgresTransactionQueryForTest`, `beforePostgresTransactionQueryForTest`, `interceptPostgresTransactionQueriesForTest`
- `rejectPostgresReadForTest`, `rejectPostgresWriteForTest`, `rejectNextPostgresTransactionForTest`, `answerPostgresReadsForTest`, `answerPostgresWritesForTest`, `runAfterPostgresWriteForTest`, `observePostgresWritesForTest`
- `readTestDatabaseTimestamp`, `getPublicBaseTableNamesForTest`, `installPsqlPoolSocketTracking`, `registerPsqlPoolMetrics`
