---
'vouchington-tooling': minor
---

Add `vouchington-tooling/postgres-test-faults`: `withPostgresQueryFailureForTest` and
`withPostgresPoolQueryFailureForTest` fail one marked statement with a real `25P02` on any
`pg.Pool`, and `createPostgresLockObservers` waits on real lock waiters and lock chains through
`pg_stat_activity` and `pg_blocking_pids`. Pools, the advisory-lock executor, request ownership
(`isOwnedRequest`) and the observation timings are options. `pg` is an optional peer dependency.
