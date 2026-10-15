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

## Volatile functions in predicates

`uuidv7(interval)` and `random()` are volatile: PostgreSQL evaluates them for every row, so
`WHERE id >= uuidv7(INTERVAL '-30 days')` is a `Filter`, cannot be an `Index Cond`, and blocks
partition pruning. Compute the bound once per statement and compare against that. A bind
parameter works, as does a stable expression such as `now() - INTERVAL '30 days'` fed to a stable
or immutable bound helper. A stable bound can be an index condition, and a partitioned table
prunes at executor start. Confirm `Index Cond` and `Subplans Removed` in the plan.

```sql
-- evaluated per row
SELECT id FROM events WHERE id >= uuidv7(INTERVAL '-30 days');
-- bound computed once by the caller
SELECT id FROM events WHERE id >= $1;
```

## Function inlining

PostgreSQL inlines a simple scalar SQL function into the calling query, so its body is planned
with the outer query and its predicates can become index conditions. A SQL function whose body
contains a subquery (for example `EXISTS`) is never inlined. Volatile functions, functions with
`SECURITY DEFINER` or a `SET` clause, and PL/pgSQL functions are not inlined either. The plan then
shows only `fn_x(col)` in a `Filter` or output, and none of the queries it runs per row.

```sql
-- not inlined: the EXISTS runs once per orders row
CREATE FUNCTION fn_has_events(order_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM events e WHERE e.order_id = $1) $$;
SELECT id FROM orders WHERE fn_has_events(id);
-- plannable: write the semi-join in the query
SELECT o.id FROM orders o WHERE EXISTS (SELECT 1 FROM events e WHERE e.order_id = o.id);
```

Tell from the plan: a function name in `Filter` or output with no matching scan nodes. Count calls
with `SET LOCAL track_functions = 'all'` and `pg_stat_xact_user_functions` in the same transaction;
inlined functions are not counted. See [reading plans](reading-plans.md#opaque-function-calls).
Put per-row logic in the query as a join or `EXISTS`, or keep the function a plain expression.

## Reading views by key

PostgreSQL expands a view into the calling query, and a simple view lets the outer filter push
down into its base tables. A view that cannot be flattened (aggregation, `DISTINCT`, `LIMIT`,
volatile or non-inlined functions, per-row subqueries, a security barrier) is built for every
candidate row before a filter, sort, page, or count on its own columns applies. Confirm from the
plan (large `Actual Rows` and `Actual Loops` inside the view's nodes), then choose the ids from the
base tables first and read the view by its key.

```sql
-- order_summaries aggregates events, so event_count is built for every order, then filtered
SELECT * FROM order_summaries WHERE event_count > 3 ORDER BY id LIMIT 50;
-- choose ids from base tables with an equivalent predicate, then read the view by key
WITH page AS (
  SELECT o.id FROM orders o
  WHERE (SELECT count(*) FROM events e WHERE e.order_id = o.id) > 3
  ORDER BY o.id LIMIT 50
)
SELECT s.id, s.total_cents, s.event_count
FROM order_summaries s JOIN page USING (id) ORDER BY s.id;
```

Filter and sort on indexed base-table columns, and read only the view columns the page needs.
Confirm with `Actual Loops` on the view's inner nodes.

## Round trips

Sequential queries can add network round trips when the client waits between statements, and planning
can add latency when PostgreSQL does not reuse a prepared plan; count round trips per request before
tuning individual statements.

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
