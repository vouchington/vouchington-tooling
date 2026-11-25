export type GeneratedFkAlias = {
  /** Exact PostgreSQL generated expression (for example `COALESCE(a_id, b_id)`). */
  expression: string
  /** Exact CHECK constraint body ensuring one source target is set. */
  oneTargetCheck: string
  /** Local columns that must each be covered by a foreign key. */
  sourceColumns: readonly string[]
}

export type GeneratedSelfRootAlias = {
  /** Generated expression compared after whitespace collapse and lowercasing. */
  expression: string
  /** Sole primary key column the table must declare (for example `id`). */
  primaryKeyColumn: string
  /** Local column carrying a validated self-referencing foreign key to this column. */
  selfReferenceColumn: string
}

export type ReviewedKeyCatalog = ReadonlySet<string> | ReadonlyMap<string, string>

export type RelationalStorageCatalog = {
  /** Reviewed opaque JSON `table.column` entries checked for freshness. */
  allowedOpaqueJson?: ReadonlySet<string>
  /** Reviewed non-relationship UUID `table.column` entries allowed without a foreign key. */
  allowedNonrelationUuids?: ReadonlySet<string>
  /** Sole UUID `id` primary keys allowed without an independent generator or foreign key. */
  allowedOwnPrimaryUuids?: ReadonlySet<string>
  /** Reviewed token, cursor, or protocol identifiers allowed without a foreign key or as encoded keys. */
  allowedTokenCursorProtocolIds?: ReviewedKeyCatalog
  /** Reviewed audit snapshot identifiers allowed without a foreign key. */
  allowedAuditSnapshotIds?: ReviewedKeyCatalog
  /** Generated UUID alias columns backed by concrete FK columns and an exact one-target CHECK. */
  generatedFkAliases?: ReadonlyMap<string, GeneratedFkAlias>
  /** Generated self-referencing root key columns backed by a validated self-FK and sole primary key. */
  generatedSelfRootAliases?: ReadonlyMap<string, GeneratedSelfRootAlias>
  /** Exact `table.column` keys also classified as encoded entity references. */
  extraEncodedReferenceColumns?: ReadonlySet<string>
  /** Additional non-domain base PostgreSQL type names (case-insensitive) to treat as known. */
  extraKnownTypes?: ReadonlySet<string>
}

export type RelationalStorageOptions = {
  /** Repository-relative path to the schema snapshot, used in `::error file=` diagnostics. */
  snapshotPath: string
  /** Consumer-owned catalogs of reviewed exceptions and generated aliases. */
  catalog?: RelationalStorageCatalog
  /** When false, skips stale and duplicate catalog freshness checks (default: true). */
  enforceCatalogFreshness?: boolean
}

export type ObservedRelationalColumns = {
  encodedReference: Set<string>
  json: Set<string>
  missingForeignKey: Set<string>
  ownPrimary: Set<string>
}

export type ResolvedRelationalStorageCatalog = {
  allowedOpaqueJson: ReadonlySet<string>
  allowedNonrelationUuids: ReadonlySet<string>
  allowedOwnPrimaryUuids: ReadonlySet<string>
  allowedTokenCursorProtocolIds: ReadonlySet<string>
  allowedAuditSnapshotIds: ReadonlySet<string>
  acceptedUuidReference: ReadonlySet<string>
  acceptedEncodedReference: ReadonlySet<string>
  generatedFkAliases: ReadonlyMap<string, GeneratedFkAlias>
  generatedSelfRootAliases: ReadonlyMap<string, GeneratedSelfRootAlias>
  extraEncodedReferenceColumns: ReadonlySet<string>
  extraKnownTypes: ReadonlySet<string>
}
