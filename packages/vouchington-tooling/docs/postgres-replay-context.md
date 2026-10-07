# PostgreSQL replay context

`createPostgresReplayContext` projects a caller-owned schema snapshot and generated-column
reference facts into the two lookups used by replay checks. It does not load snapshots, parse SQL,
or decide INSERT policy.

The caller supplies one `{ table, column, sourceColumns }` fact for each snapshot column whose
`generated` value is `stored` and whose `generatedExpression` is present. Build `sourceColumns` from
the parser's typed expression column references, retaining each reference's final identifier
component. Supply an empty array for a valid expression with no column references. Missing facts
throw when that table's dependencies are requested, so parser failures cannot silently become an
empty dependency set.

Unknown tables return `undefined` from both lookups. Known tables return their trigger text and a
map of STORED generated columns to nonempty dependency sets; VIRTUAL columns are excluded. A known
table with no STORED dependencies returns an empty map. Dependency maps are memoized per table.
