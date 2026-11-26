---
'vouchington-tooling': minor
---

`runAfterPostgresWriteForTest` in `vouchington-tooling/postgres-test-faults` now awaits its `after` callback, which may return a promise. The intercepted write resolves only after `after` settles, and a rejected `after` rejects the write instead of becoming an unhandled rejection. A synchronous `after` behaves as before.
