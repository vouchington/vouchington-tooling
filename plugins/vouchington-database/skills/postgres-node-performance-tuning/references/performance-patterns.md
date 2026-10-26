# Performance patterns

Use pools and release checked-out clients in `finally`, especially for cursors, streams, and COPY.
Route ordinary reads to a replica when its lag is acceptable; route read-after-write, locking, and
transaction-consistent reads to the writer. Do not hold a client across unrelated application work.
Never hold a transaction, connection, or advisory lock across an external call; take a token lease
in a shared store instead, with a TTL, renewal, and compare-and-delete release. Stop work when
renewal fails, and guard any write a stale owner could make with the token.

For large reads, use keyset pagination, cursors, or streams with cancellation and bounded batches.
For writes, prefer set-based batches such as UNNEST or COPY when they preserve validation and error
handling. Do large list diffs and dedupes in the worker as a streaming comparison of sorted
inputs, not as writer-side set operations. Measure query plans with representative cardinality
before changing an index or query. Adding an index for a measured plan is a default: do not ask
first and do not make it a spec stop condition.

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
contains a subquery (for example `EXISTS`) is never inlined as a scalar call; a set-returning SQL
function in `FROM` follows a separate inlining path. Functions with `SECURITY DEFINER` or
a `SET` clause, and PL/pgSQL functions, are not inlined either, nor is a body that is not a single
simple expression. When the function is not inlined, the plan shows only `fn_x(col)` in a `Filter`
or output, and none of the queries it runs per row.

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
set operations, window functions, volatile target-list expressions, a security barrier) is built
before a filter on a value it derives (such as an aggregate) applies, and before a sort, page, or
count over its output. A restriction on a grouping column can still be pushed below an aggregate,
so let the plan decide. Confirm from the
plan (large `Actual Rows` and `Actual Loops` inside the view's nodes), then choose the ids from the
base tables first and read the view by its key, as a correlated `LATERAL` lookup so the page
restriction can reach inside the view. This works for an aggregate or `GROUP BY` view whose key is
a grouping column; a `LIMIT` in the view blocks pushdown of any qual, so rewrite that view's query
against the base tables instead. A plain join to the page is a join clause, not a restriction
inside the view, so the planner can still build the whole aggregate first.

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
FROM page
CROSS JOIN LATERAL (
  SELECT * FROM order_summaries WHERE id = page.id
) s
ORDER BY s.id;
```

Filter and sort on indexed base-table columns, and read only the view columns the page needs.
Confirm in the plan that the view's inner nodes run with `Actual Loops` equal to the page size and
read only that page's rows.

## Round trips

Sequential queries can add network round trips when the client waits between statements, and planning
can add latency when PostgreSQL does not reuse a prepared plan; count round trips per request before
tuning individual statements.

Load a parent and the viewer's relation to it in one query: join the membership row, or use a
lateral subquery, rather than reading the parent and then the relation.

`Promise.all` over statements on one transaction client is still serial, because one connection
runs one statement at a time. Merge them instead: CTEs, `UNNEST`, or one multi-row statement.

Write the batch implementation first: it takes an array of keys and returns a keyed map. The
single-item function is a thin wrapper over it (`addUrl(url)` calls `addUrls([url])`), with no
parallel per-item SQL path, for lookups and mutations alike. Keep atomicity, partial-failure,
ordering, duplicate-key, and result-shape semantics identical, or keep a per-item path. Call the batch from loops, `.map`
callbacks, and `Promise.all` fan-outs. `no-await-in-loop` misses a helper that queries internally
and `Promise.all(items.map(helper))`; review those call sites by hand.

Overlap independent cache and PostgreSQL reads with `Promise.all`, such as a rate-limiter check
alongside the user fetch. Serialize only true dependencies, where one result feeds the next call. Suppress the
sequential-await lint only when each step consumes the previous step's result; a shared
transaction client or lock ordering is not a data dependency. A lock that must be taken first
stays a separate, earlier statement; never reorder or parallelize it. Audit every added suppression.

Correctness comes before round trips. Before folding a statement away, state the guarantee it
gave (what it locked, which snapshot it read) and reject the fold if that weakens. An `EXISTS`
inside a `FOR UPDATE` statement reads a snapshot taken before the lock wait, so it can be stale.

Run a symmetric check, such as "is either party blocking the other", as one query with an `OR`
or both-direction predicate, not twice with the arguments swapped.
