# Table shapes

Choose a shape by lifecycle and meaning. Do not store hand-synchronized status beside lifecycle
timestamps. A final lifecycle derives enum status with an immutable generated expression over
timestamps such as `claimed_at`, `completed_at`, and `failed_at`. A time-based expiry needs an
explicit sweeper-written timestamp; `now()` cannot appear in an immutable generated expression.
When state keeps returning to earlier states, record append-only attempts or changes and derive
current state from the latest row rather than erasing the previous lifecycle.

| Concept                    | Shape                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Field-diff history         | `<entity>_revisions`: UUIDv7 `id`, entity FK, nullable revision actor FK with `ON DELETE SET NULL`, revision-type enum, `changes jsonb`.                                                   |
| Typed lifecycle ledger     | `<entity>_changes`: UUIDv7 `id`, entity FK, change-type enum, retained actor identity FK with `ON DELETE RESTRICT`, typed joined payload and JSON for unjoined data. Time comes from `id`. |
| Current state from a log   | Latest change by `id DESC`, projected through a shared trigger or read through a view.                                                                                                     |
| Per-entity work            | `<entity>_<job>_work_items`: entity FK, lease and final-outcome columns, claim index, retention.                                                                                           |
| Job progress               | `<job>_cursors`: finite enum key or checked singleton, keyset positions without FKs, optional sweep upper bound.                                                                           |
| Inbound or protocol events | Append-only `<source>_events` with `occurred_at` recording the event's business time.                                                                                                      |

Revisions and changes are append-only through a generic `fn_reject_mutation`, parameterized by
actor columns that may be erased to NULL. Permit only those erasures; parent-cascade deletion
may be permitted by policy. A trigger-depth test alone cannot prove a delete came from a parent
cascade, because another trigger also increases depth. Do not copy the parent into each ledger
row. Keep historical before/after snapshots as JSON rather than joined history child tables.
A system change has a NULL actor. Retained actors remain historical identities, without authority.

## Work leases

The lease lives on a row that exists only for the work. If an invoice outlives a delivery job,
use `invoice_delivery_work_items`, with an invoice FK and `ON DELETE CASCADE`, rather than putting
the lease on the invoice. Do not create a shared polymorphic lease table.

Use `lease_token uuid`, `leased_at`, `lease_expires_at`, `attempt_count`, `available_at`, and
`completed_at` plus timestamps for final outcomes. Add `generation` only when re-enqueue can race
a running worker. Each claim or reclaim gets a fresh opaque token. Every renewal, completion,
and failure must include `WHERE lease_token = $mine`; zero affected rows means ownership was lost.
Keep retries in an optional `_attempts` ledger with `attempt_number` when their lifecycle must
survive. One-shot compare-and-set claims and human assignments need their own shapes.

## Cursors and shared functions

A cursor key names the finite thing being swept. A singleton uses
`is_singleton boolean PRIMARY KEY DEFAULT true CHECK (is_singleton)`; the job seeds its own row
with `ON CONFLICT DO NOTHING`. `cursor_<thing>_id` and optional `sweep_upper_bound_<thing>_id` are
FK-free UUIDv7 positions; NULL means the start. Per-unit work progress belongs in work items.
A UUIDv7 is assigned at insert, not commit: jobs that must see every committed row re-scan an
overlap rather than assuming an id high-water mark proves commit order.

Use `updated_at` only for mutable rows, always maintained by its trigger; application code never
writes it. Comment every table, column, and view, including generated objects. Self-explanatory
columns may have explicit reviewed local exceptions; view comments describe their reader boundary.
Reuse generic trigger functions with `TG_ARGV` and `TG_TABLE_NAME`; quote dynamic identifiers
with `format('%I', ...)`. A trigger function and a SQL-callable helper are separate functions.

Generic enforcement in `jonathanong/no-mistakes`: `postgres-table-shape` and
`postgres-duplicate-function-body`. Configure canonical shapes explicitly and verify which
rules the installed release supports; lifecycle and authority decisions still need review.
