# Performance patterns

Use pools and release checked-out clients in `finally`, especially for cursors, streams, and COPY.
Route ordinary reads to a replica when its lag is acceptable; route read-after-write, locking, and
transaction-consistent reads to the writer. Do not hold a client across unrelated application work.

For large reads, use keyset pagination, cursors, or streams with cancellation and bounded batches.
For writes, prefer set-based batches such as UNNEST or COPY when they preserve validation and error
handling. Measure query plans with representative cardinality before changing an index or query.

Check query predicates, joins, ordering, and selected columns against index shape. Use EXPLAIN
evidence to confirm planner behavior. Add extended statistics only when observed estimates show a
correlation problem; verify the statistics are collected and used. Partitioning can reduce scanned
data, but it does not replace suitable local indexes or predicates that permit pruning.

## Query shapes

Test existence with `EXISTS`, not `COUNT(*) > 0`. Use correlated `NOT EXISTS` rather than
`NOT IN (SELECT ...)`, whose NULL behavior can silently exclude expected rows. Filter and order
UUIDv7 rows by `id`, not generated `created_at`, so the key's index supports the query.
Read and return tables with explicit columns: no `SELECT *`, `alias.*`, or `RETURNING *`.
A view may use `*` when its reviewed column list is the reader contract.

Use keyset pagination, never `OFFSET`. An optimizer fence is a `MATERIALIZED` CTE, not
`OFFSET 0`. Constrain a partitioned table's partition key, or document the reason for a
cross-partition query. Choose the partition key from dominant access patterns; a hot reader
of `RANGE (id)` needs an id or time bound.

For a `RANGE (id)` child read by parent id, a shared lower-bound helper equivalent to
`id >= min_uuidv7(uuid_extract_timestamp(parent_id) - interval '1 hour')` prunes earlier
partitions; the overlap allows clock skew. It is safe only when every writer sets the parent at
insert to an existing parent, never re-points it to a newer parent, and nothing mints child ids
from a historical time; see
[parent lower bound](../../postgres-partitioning-uuid-v7/references/partition-lifecycle.md#parent-lower-bound).
Rate limits query an actor-keyed table rather than
recipient-keyed fan-out rows. Verify actual pruning with EXPLAIN.

Generic `jonathanong/no-mistakes` checks include `postgres-no-offset`; inspect available rules
and configure reviewed cross-partition exceptions rather than treating a rule as plan evidence.

## Round trips

Each sequential query costs a network round trip plus planning; count round trips per request
before tuning individual statements.

Load a parent and the viewer's relation to it in one query: join the membership row, or use a
lateral subquery, rather than reading the parent and then the relation.

`Promise.all` over statements on one transaction client is still serial, because one connection
runs one statement at a time. Merge them instead: CTEs, `UNNEST`, or one multi-row statement.

Give every per-item lookup helper a batch twin that takes an array of keys and returns a keyed
map, and call the twin from loops, `.map` callbacks, and `Promise.all` fan-outs. `no-await-in-loop`
misses a helper that queries internally and `Promise.all(items.map(helper))`; review those call
sites by hand.

Overlap independent cache and PostgreSQL reads with `Promise.all`, such as a rate-limiter check
alongside the user fetch. Serialize only true dependencies, where one result feeds the next call.

Run a symmetric check, such as "is either party blocking the other", as one query with an `OR`
or both-direction predicate, not twice with the arguments swapped.
