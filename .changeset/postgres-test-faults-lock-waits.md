---
'vouchington-tooling': minor
---

Extend `vouchington-tooling/postgres-test-faults` with the pool-agnostic client-lock observers:
`withTestOwnedPostgresWait` and `createTestPostgresMultiWait` witness a real PostgreSQL lock wait
through the native `log_lock_waits` notice, and `observePostgresLockNotice`,
`createTestPostgresClientLoan`, `reserveTestPostgresObserver` and `abortTestPostgresTransaction`
are exported as building blocks. Pools and request ownership are parameters. Both fault helpers
also accept `matchesValues` to narrow a fault to a statement's bound values.
