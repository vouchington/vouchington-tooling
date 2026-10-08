# Sweep patterns

Synthetic examples for [bounded iteration](../SKILL.md). `db.query` stands for the consumer's
executor and `config` for its runtime configuration; every cap in SQL is a bound parameter.
`min_uuidv7(timestamptz)` stands for the consumer's helper that returns the smallest UUIDv7 for a
timestamp, like the lower-bound helper in
[performance patterns](../../postgres-node-performance-tuning/references/performance-patterns.md).
Comments on tables and columns are omitted for space.

## Due timestamp, partial index, capped claim

A work-item row exists only while work is pending, so the index covers only rows a claim can pick:

```sql
CREATE INDEX idx_invoice_delivery_work_items__available_at
  ON invoice_delivery_work_items (available_at, id)
  WHERE completed_at IS NULL;
```

One claim takes at most `$1` due rows. Competing workers skip rows another worker holds, and the
lease moves `available_at` to its expiry, so an abandoned claim is due again through the same index
without an `OR` in the predicate:

```sql
WITH due AS (
  SELECT id
  FROM invoice_delivery_work_items
  WHERE completed_at IS NULL AND available_at <= now()
  ORDER BY available_at, id
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
UPDATE invoice_delivery_work_items AS item
SET lease_token = gen_random_uuid(),
    leased_at = now(),
    lease_expires_at = now() + $2::interval,
    available_at = now() + $2::interval,
    attempt_count = item.attempt_count + 1
FROM due
WHERE item.id = due.id
RETURNING item.id, item.invoice_id, item.lease_token;
```

Renewal moves `lease_expires_at` and `available_at` to the same new deadline, so a renewed lease
is not due. Renewal, completion, and failure all add `AND lease_token = $mine`; see
[table shapes](../../postgres-schema-design/references/table-shapes.md).

## Dirty marker or work item

Do not walk every order to find the few that need reconciling. The writer that changes an order
marks it in the same transaction, and the reconciler claims only marks, as above:

```sql
CREATE TABLE order_reconcile_work_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  generation integer NOT NULL DEFAULT 0,
  completed_at timestamptz
);

INSERT INTO order_reconcile_work_items (order_id)
VALUES ($1)
ON CONFLICT (order_id) DO UPDATE
SET available_at = GREATEST(order_reconcile_work_items.available_at, now()),
    completed_at = NULL,
    generation = order_reconcile_work_items.generation + 1;
```

The claim above applies with `order_id` for `invoice_id`, and its `RETURNING` also includes
`generation`, so `$claimed` is captured in the same statement as the lease. Completion adds
`AND generation = $claimed`. A re-mark never makes a leased row due early, since
the claim moved `available_at` to the lease expiry. A completion that finds a newer generation
releases the lease with `available_at = now()`, and the next claim takes the row again. Run cost
follows the number of changes, not the number of orders. A job fanned out per account reads by
parent id, `WHERE account_id = $1`, for the one account it was started for.

## High-water-mark window with an overlap

An export reads `invoices` added since the last sweep. The cursor row holds the position and the
sweep's fixed end, and the job seeds its own row:

```sql
CREATE TABLE invoice_export_cursors (
  is_singleton boolean PRIMARY KEY DEFAULT true CHECK (is_singleton),
  cursor_invoice_id uuid,
  sweep_upper_bound_invoice_id uuid
);

INSERT INTO invoice_export_cursors DEFAULT VALUES ON CONFLICT DO NOTHING;
```

A UUIDv7 is assigned at insert, not commit, so a row below the last sweep's end can commit after
that sweep passed it. A new sweep starts an overlap before the previous end and fixes its own end
now, only when the previous sweep reached its end. `$1` is the overlap, and NULL means the start,
so the first sweep begins at the start. The overlap must exceed the longest insert-to-commit
delay, which the consumer enforces, for example with a transaction timeout; a row that commits
after the overlap has passed is missed for good. Work that cannot tolerate a miss writes a
work-item row in the same transaction instead:

```sql
UPDATE invoice_export_cursors
SET cursor_invoice_id =
      min_uuidv7(uuid_extract_timestamp(sweep_upper_bound_invoice_id) - $1::interval),
    sweep_upper_bound_invoice_id = min_uuidv7(now())
WHERE is_singleton
  AND cursor_invoice_id IS NOT DISTINCT FROM sweep_upper_bound_invoice_id;
```

Each batch moves strictly forward inside the sweep, where `$1` is the cursor (the nil UUID for the
start), `$2` the sweep's end, and `$3` the batch size:

```sql
SELECT id, account_id, total_cents
FROM invoices
WHERE id > $1 AND id <= $2
ORDER BY id
LIMIT $3;
```

Persist the last `id` as the cursor after each batch with a compare-and-set, so a stale or
overlapping worker cannot move the position backward or into another sweep. `$1` is the new
position, `$2` the cursor this batch started from (NULL at the start), and `$3` the sweep's end.
Zero updated rows means another worker moved on, so the run stops:

```sql
UPDATE invoice_export_cursors
SET cursor_invoice_id = $1
WHERE is_singleton
  AND cursor_invoice_id IS NOT DISTINCT FROM $2::uuid
  AND sweep_upper_bound_invoice_id = $3;
```

A short batch ends the sweep: set the cursor to the sweep's end the same way, and the next run
starts a new sweep. Rows in the overlap are read twice, so the export must be idempotent.

A time position works the same way on a column the database sets at insert, such as
`received_at timestamptz NOT NULL DEFAULT clock_timestamp()`, with the same overlap rule. Never use a business
time such as `occurred_at`: a late-arriving row carries an old timestamp and falls behind every
later window. Avoid `now()` too, because it records the transaction's start, not the insert. Fix the window's end when the window opens, keep a composite `(time, id)` keyset
position inside it, and read
`WHERE (received_at, id) > ($1, $2) AND received_at <= $3 ORDER BY received_at, id`, where `$3` is
the window's end. Rows that share a timestamp are neither skipped nor repeated, and new arrivals
wait for the next window. Advance `<verb>_through_at` to the window's end only after the window is
drained, and start the next window an overlap earlier.

## Capped batch loop with `hasMore`

The run stops at a batch cap or a deadline and says whether work remains. A short batch is the
only proof that nothing is left. Rows a `SKIP LOCKED` claim passed over are held by another
claimer, who owns them; if that claim rolls back, they are due again on the next scheduled run,
so a short batch still ends this run's backlog. A cap that stops the run reports
`hasMore: true`, even when the last batch happened to drain the work; the continuation finds
nothing and stops:

```ts
interface RunResult {
  processed: number
  hasMore: boolean
}

export async function runOrderReconcile(config: ReconcileConfig): Promise<RunResult> {
  const deadline = Date.now() + config.runDeadlineMs
  let processed = 0
  for (let batch = 0; batch < config.maxBatchesPerRun; batch += 1) {
    if (Date.now() >= deadline) return { processed, hasMore: true }
    const items = await claimDueItems(config.batchSize, config.leaseInterval)
    await reconcileOrders(items)
    processed += items.length
    if (items.length < config.batchSize) return { processed, hasMore: false }
  }
  return { processed, hasMore: true }
}

export async function orderReconcileJob(config: ReconcileConfig): Promise<void> {
  const { hasMore } = await runOrderReconcile(config)
  if (hasMore) await enqueueContinuation('order-reconcile')
}
```

The persisted position is the work-item table itself: claimed and completed rows leave the due
set. A cursor sweep persists its position after each batch. The job asks for a continuation
instead of looping on.

## Tunables

Read each cap from runtime configuration with a validated default and a hard maximum. A bad value
fails at startup, and no cap is unset or infinite:

```ts
interface Bound {
  default: number
  max: number
}

export function readBound(name: string, raw: string | undefined, bound: Bound): number {
  const value = raw === undefined ? bound.default : Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > bound.max) {
    throw new RangeError(`${name} must be an integer from 1 to ${bound.max}`)
  }
  return value
}

const batchSize = readBound('ORDER_RECONCILE_BATCH_SIZE', env.ORDER_RECONCILE_BATCH_SIZE, {
  default: 200,
  max: 1000,
})
```

Bind the value as a parameter, `LIMIT $1`, never a literal in SQL text. `LIMIT 1` for a single-row
lookup and an external API's documented page maximum are contracts, not tunables.

## List endpoint

The API schema keeps a static ceiling. The runtime default and effective maximum are tunable but
never above it, and the server rejects an invalid size and clamps a large one:

```ts
const API_MAX_PAGE_SIZE = 100

export function pageSize(requested: number | undefined, config: PageConfig): number {
  const ceiling = Math.min(config.maxPageSize, API_MAX_PAGE_SIZE)
  const value = requested ?? config.defaultPageSize
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError('Page size must be a positive integer')
  }
  return Math.min(value, ceiling)
}
```

Page by keyset on the key the index serves. Fetch `pageSize + 1` rows to learn whether another page
exists, return `pageSize`, and encode the last returned `id` as the next cursor. The first page
omits `id < $2`:

```sql
SELECT id, total_cents
FROM orders
WHERE account_id = $1 AND id < $2
ORDER BY id DESC
LIMIT $3;
```

## Bounded DELETE through a CTE

DELETE has no `LIMIT`, so select the ids in a CTE and delete by join. The partial index serves the
retention predicate, and `$1` is the cutoff and `$2` the batch size:

```sql
CREATE INDEX idx_invoice_delivery_work_items__completed_at
  ON invoice_delivery_work_items (completed_at, id)
  WHERE completed_at IS NOT NULL;

WITH expired AS (
  SELECT id
  FROM invoice_delivery_work_items
  WHERE completed_at IS NOT NULL AND completed_at < $1
  ORDER BY completed_at, id
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
DELETE FROM invoice_delivery_work_items AS item
USING expired
WHERE item.id = expired.id;
```

Report `hasMore` when the deleted row count equals the batch size, and let the next run continue.

## Deduplicate against a large table

Do not load every existing key to diff against a candidate list. Ask the table about the
candidates only, in chunks whose size is a bounded tunable. The candidates themselves come from a
capped page:

```sql
SELECT external_ref
FROM order_imports
WHERE account_id = $1 AND external_ref = ANY($2::text[]);
```

```ts
const known = new Set<string>()
for (const chunk of chunks(candidates, config.lookupChunkSize)) {
  const rows = await db.query(findKnownRefsSql, [accountId, chunk])
  for (const row of rows) known.add(row.external_ref)
}
const fresh = candidates.filter((ref) => !known.has(ref))
```

When the goal is only to insert the new rows, `INSERT ... ON CONFLICT DO NOTHING RETURNING` skips
the lookup.

## Per-row interval: one bucket per threshold

When the rule lives on the row, such as a per-site refresh interval, compare the stored fact with
a bound per distinct threshold value, never with another column. `swept_at` stores when the last
_completed_ sweep started; set it from the sweep's own start time when the sweep reports no more
work. Each interval value is a bucket the index can seek into. A recursive CTE walks the leading
column of the index one distinct value at a time (a loose index scan, or skip scan), so finding
the buckets reads one index entry per bucket, not every enabled site. Each bucket is capped on its
own, so one busy bucket cannot starve the others. Each branch inside a bucket has its own cap too,
so a steady stream of never-swept sites cannot starve overdue rows. A run returns at most
2 times `$1` rows per bucket:

```sql
CREATE INDEX idx_sites__refresh_due
  ON sites (refresh_interval_days, swept_at NULLS FIRST, id)
  WHERE is_enabled;

WITH RECURSIVE bucket AS (
  (SELECT refresh_interval_days FROM sites
   WHERE is_enabled
   ORDER BY refresh_interval_days LIMIT 1)
  UNION ALL
  SELECT next_bucket.refresh_interval_days
  FROM bucket
  CROSS JOIN LATERAL (
    SELECT refresh_interval_days FROM sites
    WHERE is_enabled AND refresh_interval_days > bucket.refresh_interval_days
    ORDER BY refresh_interval_days LIMIT 1
  ) next_bucket
)
SELECT due.id, bucket.refresh_interval_days
FROM bucket
CROSS JOIN LATERAL (
  (SELECT id FROM sites
   WHERE is_enabled AND refresh_interval_days = bucket.refresh_interval_days
     AND swept_at IS NULL
   ORDER BY id LIMIT $1)
  UNION ALL
  (SELECT id FROM sites
   WHERE is_enabled AND refresh_interval_days = bucket.refresh_interval_days
     AND swept_at < now() - bucket.refresh_interval_days * interval '1 day'
   ORDER BY swept_at, id LIMIT $1)
) due;
```

The loose scan beats a small thresholds table here because the intervals are chosen per row and
there is no second source of truth to drift. If the intervals are a fixed, reviewed set, a
thresholds table is just as bounded. Either way the bucket count must itself be bounded, for
example by a `CHECK` that restricts `refresh_interval_days` to the allowed values. Declare the
column `NOT NULL` with a default as well: a NULL interval is never enumerated by the loose scan
(`>` skips NULL) and never compares as due, so that site would never be swept.

Comparing `swept_at < now() - refresh_interval_days * interval '1 day'` alone cannot use an index:
the right side depends on the row's own column, and `timestamptz + interval` is not immutable, so
the sum cannot be indexed or stored as a generated column. Inside a bucket the interval is a
constant, so the bound is a plain range on `swept_at`.

Each condition is its own branch. `swept_at IS NULL OR swept_at < $bound` is not one index range:
the planner makes `refresh_interval_days = k` the index condition and applies the `OR` as a filter.
When fewer rows are due than the cap, that scan reads every row in the bucket. Verify by rows, not
scan type: the plan's actual rows read stay close to the rows returned, and `Rows Removed by
Filter` is near zero.

## Age milestones from the UUIDv7 key

An account crosses age `M` when `now - M` passes its creation time, which the key encodes. So
"crossed `M` since the last run" is a primary-key range with no stored column. `$1` is the previous
run's time minus an overlap (the window start), `$2` the window end, fixed when the window opens,
`$3` the milestone interval, `$4` the last `id` already read (the nil UUID at the start of a
window), and `$5` the cap. This holds only when ids are minted at creation and never for imports
or backfills; where that is not guaranteed, drive milestones from an indexed immutable `created_at`
range instead (see the [parent lower bound](../../postgres-partitioning-uuid-v7/references/partition-lifecycle.md#parent-lower-bound)
conditions on historical ids):

```sql
CREATE INDEX idx_accounts__open ON accounts (id) WHERE closed_at IS NULL;

SELECT id FROM accounts
WHERE id >= min_uuidv7($1::timestamptz - $3::interval)
  AND id <  min_uuidv7($2::timestamptz - $3::interval)
  AND id >  $4
  AND closed_at IS NULL
ORDER BY id
LIMIT $5;
```

Without the partial index, `closed_at IS NULL` is a filter on the primary-key range, and a window
where most accounts are closed reads every one of them. Verify by rows: the plan's rows read stay
close to the rows returned.

A window can hold more accounts than the cap, so persist the last `id` returned after each batch
and page inside the fixed window with `id > $4`. Advance the window only after a short batch: the
next window starts an overlap before this one's end (`$2`), with the nil UUID as `$4`. Moving the
start to the window's end after a capped batch would skip the accounts not yet read. This is the
`age_milestone` signal's `last_id` in the dispatcher cursor table below.

## One dispatcher per signal

The anti-pattern is one keyset walk over every account with an `OR` of unrelated reasons. No index
serves the `OR`, so every account is read to find the few that need work:

```sql
SELECT a.id
FROM accounts a
WHERE a.id > $1
  AND (a.id < min_uuidv7(now() - $2::interval)
       OR EXISTS (SELECT 1 FROM subscriptions s
                  WHERE s.account_id = a.id AND s.expires_at < now())
       OR EXISTS (SELECT 1 FROM plan_changes c
                  WHERE c.account_id = a.id AND c.id > $3))
ORDER BY a.id
LIMIT $4;
```

Replace it with one dispatcher per signal, each with its own index-served predicate, position, and
schedule. A signal backed by several timestamp columns reads one indexed range per column, joined
with `UNION ALL`, not an `OR` across columns. A window can hold more rows than the cap, so each
dispatcher pages inside it with a composite keyset position, as in the high-water-mark window.
`$1` is the window end, `$2` and `$3` the position (`last_at`, `last_id`), and `$4` the cap:

```sql
-- age milestones: the accounts range above, with `id > $3` as the position and
-- `id < min_uuidv7($1 - milestone)` as the window end

-- subscription expirations: one indexed range per timestamp column, merged by (at, id)
-- (catches only expiries that pass in real time; see the note below)
SELECT at, id, account_id FROM (
  (SELECT expires_at AS at, id, account_id FROM subscriptions
   WHERE (expires_at, id) > ($2, $3) AND expires_at < $1
   ORDER BY expires_at, id LIMIT $4)
  UNION ALL
  (SELECT grace_ends_at AS at, id, account_id FROM subscriptions
   WHERE (grace_ends_at, id) > ($2, $3) AND grace_ends_at < $1
   ORDER BY grace_ends_at, id LIMIT $4)
) either_column
ORDER BY at, id
LIMIT $4;

-- plan changes: a UUIDv7 window, with `last_id` (seeded at the overlap boundary) as the position
SELECT id, account_id FROM plan_changes
WHERE id > $3 AND id < min_uuidv7($1)
ORDER BY id
LIMIT $4;
```

Each dispatcher keeps its window end and position in one cursor table keyed by an enum:

```sql
CREATE TYPE account_recalc_signals AS ENUM ('age_milestone', 'subscription_expiry', 'plan_change');

CREATE TABLE account_recalc_cursors (
  signal account_recalc_signals PRIMARY KEY,
  changes_through_at timestamptz NOT NULL,
  last_at timestamptz NOT NULL,
  last_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'
);
```

`changes_through_at` is the window end, fixed when the window opens. Advance `(last_at, last_id)`
after each batch with a compare-and-set. When a batch is short, the window is drained: the next
window opens with a new `changes_through_at`, and its position restarts an overlap before the
previous end. A UUIDv7-keyed signal (`plan_change`) seeds `last_id` with
`min_uuidv7(previous end - overlap)`, never the nil UUID, which would rescan from the start of
the table; a timestamp-keyed signal sets `last_at` to the same boundary with the nil `last_id`.

`expires_at` and `grace_ends_at` are mutable business timestamps, the same trap as using
`occurred_at` as a high-water mark in the
[high-water-mark window](#high-water-mark-window-with-an-overlap). A row updated or imported with
an expiry older than the cursor position is never selected, so the dispatcher catches only
expiries that pass in real time. Any write that sets an expiry at or before now, or before the
cursor, enqueues the job directly in the write path or records an immutable change event
(`plan_changes` is one) that a UUIDv7-keyed dispatcher reads.

All of them enqueue the same `recalculateAccount` job with the per-event ids below, so a repeat
read is harmless. Writes that cause a signal, such as recording a plan change, enqueue the job in
the write path. The dispatchers are the backstop for a missed enqueue.

## Queue job ids for deduplication

A queue that deduplicates by job id ignores an add whose id already exists, including a job that is
running or retained after completion. An id keyed only by the entity drops a new trigger:

```ts
// Account A's job is running when A's subscription expires: this second add is ignored.
await queue.add('recalculateAccount', { accountId }, { jobId: `recalc__${accountId}` })
```

Key the id by the entity and the event instead. Re-reading the same event in an overlap gives the
same id, and a new event gets a new id:

```ts
await queue.add(
  'recalculateAccount',
  { accountId, changeId },
  { jobId: `recalc__${accountId}__planChanged__${changeId}` },
)
```

While the job record is retained, each trigger is enqueued at most once; that does not mean it
runs. Deduplication lasts only as long as the record: retention must cover the longest overlap or
replay interval, or a re-read event enqueues again after the record is removed. A requirement that
a trigger take effect exactly once needs a durable event ledger, not job ids. If a job fails for
good and its record is retained, the same id is still claimed, so retrying it needs an explicit
reactivate-or-remove step before the next add.

## Repair through an existing reconciler

When a side effect after commit is fire-and-forget (a cache fill, a filter add, an enqueue), repair
it in the reconciler that already reads a `changed_through_at` window of recently changed rows. Do
not create a new sweeper. `$1` and `$2` are the position (`changed_at`, `id`), seeded an overlap
before the previous window's end, `$3` the window end fixed when the window opens, and `$4` the cap:

```sql
SELECT id, handle, version
FROM accounts
WHERE (changed_at, id) > ($1, $2) AND changed_at <= $3
ORDER BY changed_at, id
LIMIT $4;
```

Advance the position after each batch with a compare-and-set, and open the next window only after a
short batch, as in the dispatcher cursor table.

```ts
for (const account of await db.query(recentlyChangedAccountsSql, [
  ...position,
  to,
  config.batchSize,
])) {
  // Monotonic: the write compares `version`, so a delayed repair never overwrites a newer value.
  await accountCache.fillIfNotOlder(account.id, account, account.version)
  await addHandle(account.handle) // idempotent; the invalidating helper from membership filters
}
```

Idempotence alone is not enough, because the overlap reads rows twice and a delayed repair can land
after a newer write. Make each repair monotonic: compare an integer `version` that every update
increments (`version = version + 1`) on write, or invalidate the cache entry and let the next read
load the current row. Do not compare `changed_at = now()`: it is the transaction's start time and
is not monotonic across concurrent transactions.

## Membership filters

A membership filter needs every key, but never on a schedule. The write path adds immediately after
commit. A failed add stops trusting the filter, by clearing its ready marker so reads fall back to
the source of truth, and enqueues a rebuild. The job id includes the filter generation: a fixed id
would stay claimed once its record is retained, so a later failure could never enqueue. Each
invalidation bumps the generation, so concurrent enqueues for one failure share an id and a new
failure gets a new one. The reconciler repairs missed adds from its window, and a read that finds
the filter missing enqueues the same rebuild:

```ts
async function enqueueRebuild(generation: number, afterId = 'start'): Promise<void> {
  try {
    const jobId = `rebuildFilter__handles__${generation}__${afterId}`
    await queue.add('rebuildFilter', { generation, afterId }, { jobId })
  } catch (error) {
    logger.warn({ error }, 'could not enqueue the filter rebuild') // best effort
  }
}

export async function addHandle(handle: string): Promise<void> {
  try {
    await handleFilter.add(handle)
  } catch {
    await enqueueRebuild(await handleFilter.invalidate()) // clears ready, bumps the generation
  }
}

export async function hasHandle(handle: string): Promise<boolean> {
  if (!(await handleFilter.isReady())) {
    await enqueueRebuild(await handleFilter.generation())
    return handleExistsInDatabase(handle) // the read falls back even if the enqueue failed
  }
  // Hint only: a negative means "definitely absent" for keys committed before the last
  // successful add or rebuild. A positive may be a false positive, so verify it at the source.
  try {
    if (!(await handleFilter.has(handle))) return false
  } catch {
    await enqueueRebuild(await handleFilter.invalidate()) // a failing filter is not trusted
  }
  return handleExistsInDatabase(handle)
}
```

The add happens after commit, so while it is in flight a committed handle can be missing from a
ready filter. The filter is therefore only a hint for callers that tolerate a just-committed miss,
such as an availability pre-check. Correctness-critical paths, such as a uniqueness check or a
read-your-writes lookup, use the database or its unique constraint and never trust a negative.

The rebuild is an explicit, capped, resumable backfill with a keyset cursor, as in the
high-water-mark window. Each capped page enqueues its continuation with the cursor in the job id
(`rebuildFilter__handles__${generation}__${afterId}`), because a generation-only id would block the
next page of the same generation. Each page checks that its generation is still current before
scanning and again before enqueueing a continuation, and a stale page exits without doing
anything. The rebuild captures its generation when it starts and sets the
ready marker last, by a compare-and-set that succeeds only while that generation is still current
(`markReady(generation)`), so a stale rebuild never overwrites a newer invalidation. Deleted keys and growth past
capacity only cost false positives, so they are an operator's rebuild, not a schedule.

## Global ranking

A result that depends on every row, such as a percentile tier, needs every row's score whatever the
design. Keep one periodic aggregate. `$1` and `$2` are the tier cutoffs:

```sql
WITH per_plan AS (
  SELECT s.channel_id, s.plan_id, count(*) AS subscribers
  FROM subscriptions s
  WHERE s.canceled_at IS NULL
  GROUP BY s.channel_id, s.plan_id
), weighted AS (
  SELECT p.channel_id, sum(p.subscribers * plan.subscriber_weight) AS score
  FROM per_plan p
  JOIN plans plan ON plan.id = p.plan_id
  GROUP BY p.channel_id
), scores AS (
  -- Start from channels so one with no active subscribers scores 0 instead of dropping out.
  SELECT c.id AS channel_id, coalesce(w.score, 0) AS score
  FROM channels c
  LEFT JOIN weighted w ON w.channel_id = c.id
), ranked AS (
  SELECT channel_id, PERCENT_RANK() OVER (ORDER BY score) AS percentile, score
  FROM scores
)
SELECT channel_id,
       CASE WHEN score = 0 THEN 'low'
            WHEN percentile >= $1 THEN 'top'
            WHEN percentile >= $2 THEN 'mid'
            ELSE 'low' END AS tier
FROM ranked;
```

`PERCENT_RANK()` gives tied scores the lowest rank, so a large tie at score 0 stays at percentile 0
instead of reading as a high cumulative fraction, and score 0 is forced into the low tier. Write
back only the changed tiers, in capped keyset batches over the result. Keeping a subscriber
count current on every subscribe and unsubscribe is more total work: it makes one hot `channels`
row take every write, and a plan change fans out to every channel the account follows. It does not
make tiers fresher either, because the percentile still needs every channel's score. Give the one
aggregate pass an EXPLAIN budget at representative size.

## External listing with a continuation token

An object-storage or API listing loop caps the pages per run. When more remain, it enqueues a
continuation job carrying the provider's continuation token. Restarting from page one each run is
not a bound: items that keep failing at the front starve the rest.

```ts
export async function listingJob(
  { token, traversalId = randomUUID() }: { token?: string; traversalId?: string },
  config: ListingConfig,
): Promise<void> {
  let next = token // traversalId is minted when a traversal starts at page one
  for (let page = 0; page < config.maxPagesPerRun; page += 1) {
    const result = await provider.list({ continuationToken: next, maxKeys: config.pageSize })
    await enqueueItems(result.items)
    if (result.nextToken !== undefined && result.nextToken === next) {
      throw new Error('Provider repeated its continuation token') // never loop or re-enqueue it
    }
    next = result.nextToken
    if (!next) return
  }
  // The traversal id keeps a provider that reuses a token across traversals from colliding.
  await queue.add(
    'listing',
    { token: next, traversalId },
    { jobId: `listing__${traversalId}__${next}` },
  )
}
```

## Verify with a plan

Run each statement with representative parameters against representative table sizes, because a
small table scans sequentially for good reason. The `due` query of the claim above should plan as
a `Limit` over a `LockRows` over an index scan on the partial index, with no `Sort` between the
scan and the `Limit`. Read the rows each node returns, not only the scan type: an index scan that
feeds a `Sort` below the `Limit` still reads every match. A `Seq Scan` on a table that grows is
also a finding:

```sql
PREPARE claim_due (integer) AS
SELECT id
FROM invoice_delivery_work_items
WHERE completed_at IS NULL AND available_at <= now()
ORDER BY available_at, id
LIMIT $1
FOR UPDATE SKIP LOCKED;

BEGIN;
EXPLAIN (ANALYZE, BUFFERS) EXECUTE claim_due (200);
ROLLBACK;
```

`EXPLAIN ANALYZE` runs the statement, so check the claim `UPDATE` or the `DELETE` inside a
transaction that you roll back, or on a disposable copy. Under contention, `SKIP LOCKED` passes over rows other claimers hold, and those rows sit under the
`Limit`, so the scan reads the cap plus the rows concurrent claims hold. That stays bounded by the
number of workers times the batch size when claims are short, so keep the claim transaction to the
claim statement, and check the index scan's actual rows while several workers claim at once.

## Anti-patterns

| Anti-pattern                                                | Why it is unbounded                                                      | Bounded shape                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Loop until empty: `while (true)` claim, process, break on 0 | New and failing rows keep the run alive; the run has no end              | A batch or deadline cap, `hasMore`, and a continuation       |
| A stream with no cap: `for await` over every account        | Memory stays flat while run time and database work grow with the table   | Stream a keyset window and cap the rows per run              |
| A key-only walk: select every account id, then check each   | Touches every entity to find the few with work                           | Read work items, dirty markers, or a due timestamp           |
| A literal `LIMIT 500` in SQL text                           | Cannot be tuned per environment or during an incident                    | A validated tunable with a hard maximum, bound as `LIMIT $1` |
| `Promise.all(accounts.map(sync))` over a result of any size | One task per row exhausts the pool or the upstream API                   | A bounded batch with bounded concurrency                     |
| An `OR` across unrelated signals in one walk                | No index serves the `OR`, so every account is read                       | One dispatcher per signal, each with its own range           |
| Comparing a fact column with a per-row interval column      | The sum is not indexable, so every row is read                           | One bucket per interval value, bounded by a plain range      |
| Job ids keyed only by entity                                | A running or retained job silently drops a new trigger                   | An id keyed by entity and triggering event                   |
| A new sweeper beside an existing reconciler                 | A second pass over rows the reconciler already reads                     | Add the idempotent repair to the existing reconciler         |
| A scheduled membership filter rebuild                       | Reads every key on every run                                             | Rebuild on operator action or detected failure only          |
| Restarting an external listing at page one                  | Failing items at the front starve the rest                               | A continuation job carrying the provider's token             |
| `OFFSET` pagination                                         | Every page rescans and discards the rows before it                       | Keyset on the indexed key                                    |
| `UPDATE` or `DELETE` with a predicate but no `LIMIT`        | One statement locks and rewrites an unbounded row set in one transaction | A CTE that selects a capped, `SKIP LOCKED` id set            |
