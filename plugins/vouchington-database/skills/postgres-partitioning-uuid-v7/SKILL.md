---
name: postgres-partitioning-uuid-v7
description: Design PostgreSQL partitions and indexes that use time-ordered UUIDv7 identifiers efficiently.
---

# PostgreSQL partitioning with UUIDv7

Partition only after confirming lifecycle, retention, and query predicates benefit from it. Treat a
UUIDv7 as time ordered but not as a replacement for explicit business timestamps where semantics
matter. Align partition keys, primary keys, indexes, constraints, and query predicates so partition
pruning is observable. Plan creation, retention, migration, and verification as one deployable
lifecycle, including rollback and independent-reader compatibility.

Consumer wrappers own partition intervals, migration tooling, retention policy, and deploy sequencing.

Read [partition lifecycle](references/partition-lifecycle.md) before a schema or retention migration.
