# Relations

An identity that readers join is an FK column or an FK child row. JSON holds structured,
schemaless data and history snapshots, including identities recorded as they were at the time.
Do not use UUID arrays, JSON ids, or type/id pairs for live relations. A column never names a
table: use one table per target and generate any per-relation progress enum from the same metadata.
Cursor positions and random fencing tokens are intentionally not live entity references; record
their reviewed exception instead of inventing a foreign key.

Split tables when their columns or FK targets differ; share a table when only a value differs.
Identical lookup values share a row without a source discriminator. Put subtype-only columns in
a subtype table whose primary key also references the base row (`business_accounts.account_id`
references `accounts.id`). A 1:N child remains an ordinary child table.

For one of several sources, use an exclusive arc:

```sql
CHECK (num_nonnulls(order_id, invoice_id) = 1)
```

Both source columns have their own FK. If a reference must belong to the same account, enforce
`FOREIGN KEY (account_id, invoice_id) REFERENCES invoices (account_id, id)` with a corresponding
unique key on the target. A validation trigger is unnecessary. With nullable `invoice_id`,
default `MATCH SIMPLE` skips that composite check when the reference is absent.

A ledger that survives deletion references a retained identity row with explicit deletion
behavior. Retained identities preserve history; they do not authorize operations on a deleted
account, order, or invoice. Index FK columns with a leading key usable by referential checks.

Finite code-defined values use enums. Use a lookup table when values carry attributes or arrive
at runtime. Authenticated vendor-defined values are inserted into a shared lookup on first sight,
with validation and concurrent insertion handled explicitly. Do not let untrusted strangers
create unbounded permanent lookup rows; reviewed raw text can be appropriate for their input.
Free text and a lookup's own natural key are not finite sets.

Arrays are for enums or outside-defined lists; live identity collections use FK child rows,
never `uuid[]`. User-submitted URLs go through one registry with centralized normalization and
validation, then use URL FKs. Keep exact external protocol identifiers, capability URLs, and
evidence snapshots unchanged when their contract requires it; document the exception.
Do not duplicate a child collection into a parent column unless a trigger maintains the projection.

Generic enforcement in `jonathanong/no-mistakes`: `postgres-column-naming`,
`postgres-array-columns`, `postgres-table-shape`, `postgres-fk-index`, and
`postgres-require-fk-on-delete`. These cover naming, configured shapes, and FK mechanics;
inspect the installed rule versions and options rather than assuming complete semantic coverage.
Comments and reviewed exceptions remain necessary.
