---
'vouchington-tooling': minor
---

`vouchington-tooling/pg-schema-snapshot` adds `validateSchemaSnapshot(value, { snapshotPath,
partitionPolicy? })` and `loadSchemaSnapshot({ repoRoot, trackedFiles, snapshotPath, snapshot?,
partitionPolicy? })`, which fail closed on stale or malformed v2 snapshots and return the typed
`SchemaSnapshot`. Partition policy values default to everything the published `PartitionPolicy` type
allows; `partitionPolicy.{strategies,children,retentionOwners,accessClasses}` narrows them.
