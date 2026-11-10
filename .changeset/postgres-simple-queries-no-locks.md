---
'vouchington-tooling': patch
---

Add the owner's simplest-query-first and no-unnecessary-locks PostgreSQL rules to `vouchington-database` (0.11.0): complex query shapes need `EXPLAIN ANALYZE` plans beating the simple query, caps are best-effort counts, and locks cover only the rows a transaction writes, with no advisory locks or cap-exactness tables.
