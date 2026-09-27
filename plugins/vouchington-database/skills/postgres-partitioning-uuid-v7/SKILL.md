---
name: postgres-partitioning-uuid-v7
description: Design PostgreSQL partitions and pruning around UUIDv7.
---

# PostgreSQL partitioning with UUIDv7

Read applicable `AGENTS.md` and their declared adapter alias, otherwise
`.agents/skills/postgres-partitioning-uuid-v7/SKILL.md` from the repository root if present.
Local policy overrides these defaults; do not reload an already-read adapter or canonical skill.

Partition only after lifecycle, retention, and query predicates show that it helps.

- Treat a UUIDv7 as time ordered. Where the meaning matters, keep an explicit business timestamp.
- Align the partition key, primary key, indexes, constraints, and query predicates so partition
  pruning is observable.
- Plan creation, retention, migration, and verification as one deployable lifecycle. Include
  rollback and independent-reader compatibility.
- Read [partition lifecycle](references/partition-lifecycle.md) before a schema or retention
  migration.

Consumer wrapper owns: partition intervals, migration tooling, retention policy, and deploy
sequencing.
