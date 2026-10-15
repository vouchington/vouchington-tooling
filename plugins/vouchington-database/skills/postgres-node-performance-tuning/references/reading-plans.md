# Reading plans

Run `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON)` at representative cardinality, in a transaction you
roll back when the statement writes. A glance at the top node hides most of the problems below;
walk every node. `VERBOSE` adds each node's `Output` expressions, which is where a select-list
function call shows. In JSON, `Actual Rows`, `Rows Removed by Filter`, and
`Rows Removed by Join Filter` are per-loop averages, so multiply each by `Actual Loops` for the
total.

## Red flags

### Rows read per row returned

A node that reads far more rows than it passes up is doing hidden work. Compare
`Actual Rows` x `Actual Loops` with the rows the parent keeps, and read `Rows Removed by Filter`
and `Rows Removed by Join Filter` (also x `Actual Loops`). Millions removed to return tens means the predicate is not an
index condition, the index has the wrong leading columns, or a join filters after it multiplies.
Fix the index or the predicate shape, or filter before joining.

### SubPlans whose loops equal the outer row count

A node with `"Parent Relationship": "SubPlan"` and `Actual Loops` equal to the outer row count
runs once per outer row. Correlated subqueries in the select list or in a `Filter` look like
this. The statements inside a non-inlined function do not appear as SubPlans; see opaque function
calls below. Rewrite as a join, a `LATERAL` with a limit, or a
set-based aggregate computed once. An uncorrelated `InitPlan` runs once and is fine.

### `Filter` where an `Index Cond` was expected

An `Index Cond` narrows the index scan; a `Filter` runs on every row the scan returns. If a
column you expected in `Index Cond` appears in `Filter`, check for a volatile function, a cast or
function wrapping the column, a type or collation mismatch, or a column outside the index's
leading keys. See
[volatile functions in predicates](performance-patterns.md#volatile-functions-in-predicates).

A partitioned parent whose plan lists every child and shows no `Subplans Removed` may not have
been pruned at plan or executor start. Pruning on an execution-time parameter, such as a value
from the outer side of a nested loop, keeps every child in the plan; check the children's loops,
where pruned children show zero loops or `(never executed)`. Constrain the partition key with a constant, a parameter, or a once-per-statement stable
expression; the bound must not be a volatile call.

### Opaque function calls

A plan shows `fn_x(col)` in a `Filter` or output column and nothing about the queries the
function runs. A SQL function whose body contains a subquery, such as `EXISTS`, is never inlined,
so those queries run per row and stay invisible. Count the calls in one transaction:

```sql
BEGIN;
SET LOCAL track_functions = 'all';  -- superuser-only setting
SELECT count(*) FROM orders WHERE fn_is_visible(orders.id);
SELECT funcname, calls FROM pg_stat_xact_user_functions;
ROLLBACK;
```

Inlined functions are not counted, so a function missing from the view was inlined. Tested on
PostgreSQL 18.6: an `EXISTS`-bodied function was counted 90 times for 90 rows, and a
plain-expression function was inlined and not counted. `track_functions = 'pl'` skips
SQL-language functions; use `'all'`. See
[function inlining](performance-patterns.md#function-inlining).

### Text join and index conditions

`Hash Cond`, `Merge Cond`, `Join Filter`, or `Index Cond` comparing `text` or `varchar` columns
(often shown with `::text` casts) means the key is compared under collation and stored in every
referencing row and index. Join on ids and keep the string in a unique column; see
[join on ids](../../postgres-schema-design/references/relations.md#join-on-ids-never-on-text).

### Generic plans worse than custom plans

A prepared statement can switch to a generic plan after several executions, planned without the
parameter values. If a statement is fast in `psql` with literals but slow from the application,
compare `EXPLAIN (GENERIC_PLAN)` for the statement with the plan for a real value. Estimates alone
can hide the problem, and `GENERIC_PLAN` cannot be combined with `ANALYZE`; prepare the statement
and compare `EXPLAIN (ANALYZE, BUFFERS) EXECUTE` for the same skewed value under
`plan_cache_mode = force_generic_plan` and `force_custom_plan`. When the generic plan is much worse, fix the statistics or query shape first; set
`plan_cache_mode = force_custom_plan` for that statement or role only with measured evidence.

### Large sequential scans and bad estimates

A `Seq Scan` over a large table that returns few rows is usually a missing or unusable index. A
sequential scan on a small table, or one that returns most rows, is fine. Compare `Plan Rows`
with `Actual Rows` on every node that decides a join (scan inputs and join outputs): an estimate
off by 10x or more can pick the wrong join type or order. Run `ANALYZE`, then consider a higher
statistics target or extended statistics for correlated columns before changing the query.

## Checklist

1. Total rows per node versus rows kept; `Rows Removed by ...`.
2. Any SubPlan with loops equal to the outer rows.
3. `Filter` that should be `Index Cond`; partition pruning (`Subplans Removed`).
4. Function calls in `Filter` or output; count them with `pg_stat_xact_user_functions`.
5. Text keys in join and index conditions.
6. Generic versus custom plan for prepared statements.
7. Estimate versus actual on join-deciding nodes.
8. `Buffers` shared hit plus read totals against the rows returned; the split separates cache
   pressure from physical I/O.
