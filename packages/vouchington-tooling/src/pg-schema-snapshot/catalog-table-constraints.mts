/* v8 ignore start -- catalog query helpers require a live database */
import {
  EXCLUDE_EXTENSION_OWNED,
  EXCLUDE_PARTITION_CHILDREN,
  TABLE_RELKINDS,
} from './catalog-shared.mts'
import type { CatalogQuery } from './types.mts'

export type CatalogConstraintRow = {
  table_name: string
  constraint_name: string
  contype: 'c' | 'f' | 'p' | 'u'
  definition: string
  columns: string[]
  referenced_table: string | null
  referenced_columns: string[]
  on_update: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default' | null
  on_delete: 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default' | null
  validated: boolean
}

export async function readConstraints(query: CatalogQuery): Promise<CatalogConstraintRow[]> {
  const { rows } = await query<CatalogConstraintRow>(
    `/* readSchemaSnapshotConstraints */
      SELECT
        target.relname AS table_name,
        pg_constraint.conname AS constraint_name,
        pg_constraint.contype AS contype,
        pg_get_constraintdef(pg_constraint.oid) AS definition,
        to_jsonb(ARRAY(
          SELECT pg_attribute.attname
          FROM unnest(pg_constraint.conkey) WITH ORDINALITY AS key_column(attnum, position)
          JOIN pg_attribute
            ON pg_attribute.attrelid = target.oid AND pg_attribute.attnum = key_column.attnum
          ORDER BY key_column.position
        )) AS columns,
        referenced.relname AS referenced_table,
        to_jsonb(ARRAY(
          SELECT pg_attribute.attname
          FROM unnest(pg_constraint.confkey) WITH ORDINALITY AS key_column(attnum, position)
          JOIN pg_attribute
            ON pg_attribute.attrelid = referenced.oid
            AND pg_attribute.attnum = key_column.attnum
          ORDER BY key_column.position
        )) AS referenced_columns,
        CASE pg_constraint.confupdtype
          WHEN 'a' THEN 'no action'
          WHEN 'r' THEN 'restrict'
          WHEN 'c' THEN 'cascade'
          WHEN 'n' THEN 'set null'
          WHEN 'd' THEN 'set default'
          ELSE NULL
        END AS on_update,
        CASE pg_constraint.confdeltype
          WHEN 'a' THEN 'no action'
          WHEN 'r' THEN 'restrict'
          WHEN 'c' THEN 'cascade'
          WHEN 'n' THEN 'set null'
          WHEN 'd' THEN 'set default'
          ELSE NULL
        END AS on_delete,
        pg_constraint.convalidated AS validated
      FROM pg_constraint
      JOIN pg_class target ON target.oid = pg_constraint.conrelid
      JOIN pg_namespace ON pg_namespace.oid = target.relnamespace
      LEFT JOIN pg_class referenced ON referenced.oid = pg_constraint.confrelid
      WHERE pg_namespace.nspname = 'public'
        AND target.relkind = ANY($1)
        AND pg_constraint.contype = ANY($2)
        AND pg_constraint.conparentid = 0
        AND ${EXCLUDE_PARTITION_CHILDREN}
        AND ${EXCLUDE_EXTENSION_OWNED}
      ORDER BY table_name, contype, constraint_name`,
    [TABLE_RELKINDS, ['p', 'u', 'c', 'f']],
  )
  return rows
}

/* v8 ignore stop */
