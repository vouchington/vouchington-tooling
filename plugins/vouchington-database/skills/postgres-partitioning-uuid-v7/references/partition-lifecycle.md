# Partition lifecycle

UUIDv7 ordering supports range bounds and index-friendly time windows. Generate bounds from time
instead of extracting timestamps in predicates; use a generated timestamp only when application
semantics require one. Partition on the range key that queries and retention actually constrain.

Create future ranges before writes need them and maintain a default partition only with an explicit
attachment plan. Before attaching a populated range, prove the default partition excludes that range
or move conflicting rows; otherwise attachment can scan and lock the default partition.

Every primary or unique constraint on a partitioned table must include its partition key. Verify
pruning with predicates on that key, including joins whose other side needs an equivalent range
condition. UUIDv7 values are time ordered, not a promise that independently generated identifiers
have a strict ordering relationship.

## Parent lower bound

A child table partitioned `RANGE (id)` prunes when a reader bounds the child id. A reader that
starts from the parent can derive that bound from the parent's UUIDv7 id, assuming a child is never
older than its parent:

```sql
SELECT item.id, item.body
FROM order_items AS item
WHERE item.order_id = $1
  AND item.id >= min_uuidv7($2::timestamptz - $3::interval);
```

`$2` is the parent's creation time and `$3` the clock skew allowance. The bound is safe only when
both hold:

- Every writer sets `order_id` at insert, to an order that already exists, and never re-points the
  row to a newer order.
- Nothing mints child ids from a historical time: imports, backfills, and seeds.

Counterexample: `articles` clustered into a `stories` row created later. Each article id is older
than its story id, so `article.id >= min_uuidv7(story time - skew)` silently drops the older
articles. Bound such a read by the child's own window instead.

## Declaring cross-partition reads

A statement that must read every partition says so, with a reason, on the statement itself:

```sql
-- cross-partition: nightly integrity check compares order_items totals with orders
SELECT order_id, sum(quantity) FROM order_items GROUP BY order_id;
```

Do not exempt the whole table. A table-wide exemption also silences the check for every future
query on that table, including one that forgot its partition key predicate.
