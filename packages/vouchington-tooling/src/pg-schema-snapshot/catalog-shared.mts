// Ordinary tables ('r') and partitioned-table parents ('p'). Partition children always inherit
// from a parent (pg_inherits), so every query below excludes rows owned by an inhrelid — that is
// what keeps date-derived partition children (e.g. `items__p_2026_07`) out of a snapshot that must
// be identical regardless of when it was generated. Constraints need the additional conparentid
// filter in catalog-table-constraints.mts because PostgreSQL can derive a row that remains owned
// by a logical parent while referencing a physical child.
export const TABLE_RELKINDS = ['r', 'p']

// `NOT EXISTS (SELECT 1 FROM pg_depend WHERE objid = <oid> AND deptype = 'e')` excludes objects
// owned by an extension (e.g. the `pg_stat_statements`/`pg_stat_statements_info` views created by
// the pg_stat_statements extension in the public schema). Without it, extension upgrades would
// move the snapshot even though no application DDL changed.
export const EXCLUDE_EXTENSION_OWNED = `NOT EXISTS (
        SELECT 1 FROM pg_depend
        WHERE pg_depend.objid = target.oid AND pg_depend.deptype = 'e'
      )`

export const EXCLUDE_PARTITION_CHILDREN = `NOT EXISTS (
        SELECT 1 FROM pg_inherits
        WHERE pg_inherits.inhrelid = target.oid
      )`
