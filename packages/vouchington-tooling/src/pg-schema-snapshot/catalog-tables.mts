import {
  EXCLUDE_EXTENSION_OWNED,
  EXCLUDE_PARTITION_CHILDREN,
  TABLE_RELKINDS,
} from './catalog-shared.mts'
import type { CatalogQuery } from './types.mts'

export type CatalogTableRow = {
  table_name: string
  relkind: 'p' | 'r'
  partition_strategy: '' | 'h' | 'l' | 'r'
  partition_key: string | null
  comment: string | null
}

export async function readTables(query: CatalogQuery): Promise<CatalogTableRow[]> {
  const { rows } = await query<CatalogTableRow>(
    `/* readSchemaSnapshotTables */
      SELECT
        target.relname AS table_name,
        target.relkind AS relkind,
        COALESCE(pg_partitioned_table.partstrat, '') AS partition_strategy,
        pg_get_partkeydef(pg_partitioned_table.partrelid) AS partition_key,
        obj_description(target.oid, 'pg_class') AS comment
      FROM pg_class target
      JOIN pg_namespace ON pg_namespace.oid = target.relnamespace
      LEFT JOIN pg_partitioned_table ON pg_partitioned_table.partrelid = target.oid
      WHERE pg_namespace.nspname = 'public'
        AND target.relkind = ANY($1)
        AND ${EXCLUDE_PARTITION_CHILDREN}
        AND ${EXCLUDE_EXTENSION_OWNED}
      ORDER BY table_name`,
    [TABLE_RELKINDS],
  )
  return rows
}

export type CatalogColumnRow = {
  table_name: string
  column_name: string
  data_type: string
  nullable: boolean
  default_expression: string | null
  identity: '' | 'a' | 'd'
  generated: '' | 's' | 'v'
  collation: string | null
  comment: string | null
  ordinal_position: number
}

export async function readColumns(query: CatalogQuery): Promise<CatalogColumnRow[]> {
  const { rows } = await query<CatalogColumnRow>(
    `/* readSchemaSnapshotColumns */
      SELECT
        target.relname AS table_name,
        pg_attribute.attname AS column_name,
        format_type(pg_attribute.atttypid, pg_attribute.atttypemod) AS data_type,
        NOT pg_attribute.attnotnull AS nullable,
        pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid) AS default_expression,
        pg_attribute.attidentity AS identity,
        pg_attribute.attgenerated AS generated,
        pg_collation.collname AS collation,
        col_description(target.oid, pg_attribute.attnum) AS comment,
        pg_attribute.attnum AS ordinal_position
      FROM pg_attribute
      JOIN pg_class target ON target.oid = pg_attribute.attrelid
      JOIN pg_namespace ON pg_namespace.oid = target.relnamespace
      LEFT JOIN pg_attrdef
        ON pg_attrdef.adrelid = pg_attribute.attrelid AND pg_attrdef.adnum = pg_attribute.attnum
      LEFT JOIN pg_collation
        ON pg_collation.oid = pg_attribute.attcollation AND pg_collation.collname <> 'default'
      WHERE pg_namespace.nspname = 'public'
        AND target.relkind = ANY($1)
        AND pg_attribute.attnum > 0
        AND NOT pg_attribute.attisdropped
        AND ${EXCLUDE_PARTITION_CHILDREN}
        AND ${EXCLUDE_EXTENSION_OWNED}
      ORDER BY table_name, ordinal_position`,
    [TABLE_RELKINDS],
  )
  return rows
}
