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

Renewal, completion, and failure add `AND lease_token = $mine`; see
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
`received_at timestamptz NOT NULL DEFAULT now()`, with the same overlap rule. Never use a business
time such as `occurred_at`: a late-arriving row carries an old timestamp and falls behind every
later window. Fix the window's end when the window opens, keep a composite `(time, id)` keyset
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

## Work that needs every key

A membership filter or a reindex needs every key, but not on every run. Keep the derived state
current on write: the insert or a dirty marker updates it. A full rebuild is a backfill started on
purpose, with a row cap per run and a keyset cursor to resume from, as in the high-water-mark
window. A scheduler never starts it as a pass over everything.

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

EXPLAIN (ANALYZE, BUFFERS) EXECUTE claim_due (200);
```

Under contention, `SKIP LOCKED` passes over rows other claimers hold, and those rows sit under the
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
| `OFFSET` pagination                                         | Every page rescans and discards the rows before it                       | Keyset on the indexed key                                    |
| `UPDATE` or `DELETE` with a predicate but no `LIMIT`        | One statement locks and rewrites an unbounded row set in one transaction | A CTE that selects a capped, `SKIP LOCKED` id set            |
