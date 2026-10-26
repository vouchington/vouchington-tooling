---
'vouchington-tooling': patch
---

Tighten the PostgreSQL skills in `vouchington-database` (0.8.0): batch-first with a thin single-item wrapper, a sequential-await suppression test, correctness before round trips, indexes for measured plans without asking, no transaction or lock across external calls, streaming sorted diffs in the worker, finite retention by default, FK columns for ids in JSON or hashed keys, job-data positions before cursor tables, queue job ids before lease or outbox tables with compare-and-set fences, and on-demand partition ranges.
