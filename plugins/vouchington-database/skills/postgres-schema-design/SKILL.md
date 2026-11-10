---
name: postgres-schema-design
description: Design PostgreSQL names, relations, history, work queues, and cursors.
---

# PostgreSQL schema design

Read applicable `AGENTS.md` and the repository's local database adapter when present.
Local policy overrides these portable conventions.

- Names explain the stored thing; read [naming](references/naming.md) when naming schema objects.
- Columns say their type and FK target; finite sets use enums or lookup tables.
- Joined identities use foreign keys; read [relations](references/relations.md) before modeling references.
- Split differing shapes, share identical values, and keep history documents as JSON.
- Use canonical [table shapes](references/table-shapes.md) for revisions, changes, work, and cursors.
- Default to finite retention for everything except user content; see [table shapes](references/table-shapes.md#retention).
- No unnecessary locks. Owner's words: "do we have a rule? no unnecessary locks", "seems like we
  have way too many locks for no reason", "keep things simple". Lock (`FOR UPDATE`) only when a
  concurrent write would corrupt the rows this transaction writes. Never lock a read set or a
  parent row, and never use advisory locks. Caps and "don't remove the last X" guards are best
  effort: count up to the cap (`LIMIT cap+1`), then write. Never add counter or projection tables,
  slot tables, claim tables, or constraints that exist only to make a cap exact. Remove a lock by
  deleting it, not by swapping in another serializer.
- Reuse parameterized trigger functions instead of copying bodies.
- Comment every table, column, and view; document reviewed exceptions explicitly.

For query shape, read [performance patterns](../postgres-node-performance-tuning/references/performance-patterns.md).
For partition lifecycle, use [UUIDv7 partitioning](../postgres-partitioning-uuid-v7/SKILL.md).
For how jobs choose, cap, and resume over work-item and cursor tables, read
[bounded iteration](../bounded-iteration/SKILL.md).
Consumer policy owns lifecycle, retention, migration strategy, and enforcement configuration.
