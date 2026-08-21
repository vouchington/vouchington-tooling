/* v8 ignore start -- catalog query helpers require a live database */
import {
  EXCLUDE_EXTENSION_OWNED,
  EXCLUDE_PARTITION_CHILDREN,
  TABLE_RELKINDS,
} from './catalog-shared.mts'
import type { CatalogQuery } from './types.mts'

export type CatalogIndexRow = {
  table_name: string
  index_name: string
  definition: string
  access_method: string
  unique: boolean
  primary: boolean
  constraint_backed: boolean
  valid: boolean
  ready: boolean
  keys: CatalogIndexKeyRow[]
  included_columns: string[]
  predicate: string | null
}

type CatalogIndexKeyRow = {
  column: string | null
  expression: string
  opclass: string
  descending: boolean
  nulls_first: boolean
}

export async function readIndexes(query: CatalogQuery): Promise<CatalogIndexRow[]> {
  const { rows } = await query<CatalogIndexRow>(
    `/* readSchemaSnapshotIndexes */
      SELECT
        target.relname AS table_name,
        index_relation.relname AS index_name,
        pg_get_indexdef(pg_index.indexrelid) AS definition,
        pg_am.amname AS access_method,
        pg_index.indisunique AS unique,
        pg_index.indisprimary AS primary,
        EXISTS (
          SELECT 1 FROM pg_constraint WHERE pg_constraint.conindid = pg_index.indexrelid
        ) AS constraint_backed,
        pg_index.indisvalid AS valid,
        pg_index.indisready AS ready,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'column', pg_attribute.attname,
              'expression', pg_get_indexdef(pg_index.indexrelid, key_column.position::integer, true),
              'opclass', pg_opclass.opcname,
              'descending', (pg_index.indoption[(key_column.position - 1)::integer] & 1) <> 0,
              'nulls_first', (pg_index.indoption[(key_column.position - 1)::integer] & 2) <> 0
            )
            ORDER BY key_column.position
          ) FILTER (WHERE key_column.position <= pg_index.indnkeyatts),
          '[]'::jsonb
        ) AS keys,
        COALESCE(
          jsonb_agg(pg_attribute.attname ORDER BY key_column.position)
            FILTER (WHERE key_column.position > pg_index.indnkeyatts),
          '[]'::jsonb
        ) AS included_columns,
        pg_get_expr(pg_index.indpred, pg_index.indrelid) AS predicate
      FROM pg_index
      JOIN pg_class index_relation ON index_relation.oid = pg_index.indexrelid
      JOIN pg_class target ON target.oid = pg_index.indrelid
      JOIN pg_namespace ON pg_namespace.oid = target.relnamespace
      JOIN pg_am ON pg_am.oid = index_relation.relam
      LEFT JOIN LATERAL unnest(pg_index.indkey) WITH ORDINALITY AS key_column(attnum, position)
        ON true
      LEFT JOIN pg_attribute
        ON pg_attribute.attrelid = target.oid AND pg_attribute.attnum = key_column.attnum
      LEFT JOIN pg_opclass
        ON pg_opclass.oid = pg_index.indclass[(key_column.position - 1)::integer]
      WHERE pg_namespace.nspname = 'public'
        AND target.relkind = ANY($1)
        AND ${EXCLUDE_PARTITION_CHILDREN}
        AND ${EXCLUDE_EXTENSION_OWNED}
      GROUP BY
        target.relname,
        index_relation.relname,
        pg_index.indexrelid,
        pg_am.amname,
        pg_index.indisunique,
        pg_index.indisprimary,
        pg_index.indisvalid,
        pg_index.indisready,
        pg_index.indnkeyatts,
        pg_index.indpred,
        pg_index.indrelid
      ORDER BY table_name, index_name`,
    [TABLE_RELKINDS],
  )
  return rows
}

export type CatalogTriggerRow = {
  table_name: string
  trigger_name: string
  definition: string
}

export async function readTriggers(query: CatalogQuery): Promise<CatalogTriggerRow[]> {
  const { rows } = await query<CatalogTriggerRow>(
    `/* readSchemaSnapshotTriggers */
      SELECT
        target.relname AS table_name,
        pg_trigger.tgname AS trigger_name,
        pg_get_triggerdef(pg_trigger.oid) AS definition
      FROM pg_trigger
      JOIN pg_class target ON target.oid = pg_trigger.tgrelid
      JOIN pg_namespace ON pg_namespace.oid = target.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND target.relkind = ANY($1)
        AND NOT pg_trigger.tgisinternal
        AND ${EXCLUDE_PARTITION_CHILDREN}
        AND ${EXCLUDE_EXTENSION_OWNED}
      ORDER BY table_name, trigger_name`,
    [TABLE_RELKINDS],
  )
  return rows
}

/* v8 ignore stop */
