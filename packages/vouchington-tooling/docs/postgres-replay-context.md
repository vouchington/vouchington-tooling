# PostgreSQL replay context

`await createPostgresReplayContextFromSchema(schema)` collects STORED generated-expression
references using the optional `no-mistakes` SQL peer, then returns the memoized replay context.
It rejects malformed expressions, additional statements, and unsupported queries instead of
treating missing facts as an empty dependency set. Snapshots without STORED expressions do not
load the peer. Snapshot loading and INSERT policy remain the caller's responsibility.

`createPostgresReplayContext` projects a caller-owned schema snapshot and generated-column
reference facts into the two lookups used by replay checks. It does not load snapshots, parse SQL,
or decide INSERT policy.

The caller supplies one `{ table, column, sourceColumns }` fact for each snapshot column whose
`generated` value is `stored` and whose `generatedExpression` is present. Build `sourceColumns` from
the parser's typed expression column references, retaining each reference's final identifier
identity (unquoted names fold to lowercase; quoted names preserve case). Supply an empty array for a valid expression with no column references. Missing facts
throw when that table's dependencies are requested, so parser failures cannot silently become an
empty dependency set.

Unknown tables return `undefined` from both lookups. Known tables return their trigger text and a
map of STORED generated columns to nonempty dependency sets; VIRTUAL columns are excluded. A known
table with no STORED dependencies returns an empty map. Dependency maps are memoized per table.
