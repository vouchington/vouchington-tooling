import { EXCLUDE_EXTENSION_OWNED } from './catalog-shared.mts'
import type { CatalogQuery } from './types.mts'

export type CatalogEnumValueRow = {
  enum_name: string
  value: string
  sort_order: number
}

export async function readEnums(query: CatalogQuery): Promise<CatalogEnumValueRow[]> {
  const { rows } = await query<CatalogEnumValueRow>(
    `/* readSchemaSnapshotEnums */
      SELECT
        target.typname AS enum_name,
        pg_enum.enumlabel AS value,
        pg_enum.enumsortorder AS sort_order
      FROM pg_enum
      JOIN pg_type target ON target.oid = pg_enum.enumtypid
      JOIN pg_namespace ON pg_namespace.oid = target.typnamespace
      WHERE pg_namespace.nspname = 'public'
        AND ${EXCLUDE_EXTENSION_OWNED}
      ORDER BY enum_name, sort_order`,
  )
  return rows
}

export type CatalogViewRow = {
  view_name: string
  materialized: boolean
  definition: string
  comment: string | null
}

export async function readViews(query: CatalogQuery): Promise<CatalogViewRow[]> {
  const { rows } = await query<CatalogViewRow>(
    `/* readSchemaSnapshotViews */
      SELECT
        target.relname AS view_name,
        target.relkind = 'm' AS materialized,
        pg_get_viewdef(target.oid) AS definition,
        obj_description(target.oid, 'pg_class') AS comment
      FROM pg_class target
      JOIN pg_namespace ON pg_namespace.oid = target.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND target.relkind = ANY($1)
        AND ${EXCLUDE_EXTENSION_OWNED}
      ORDER BY view_name`,
    [['v', 'm']],
  )
  return rows
}

export type CatalogExtensionRow = {
  extension_name: string
  version: string
}

export async function readExtensions(query: CatalogQuery): Promise<CatalogExtensionRow[]> {
  const { rows } = await query<CatalogExtensionRow>(
    `/* readSchemaSnapshotExtensions */
      SELECT extname AS extension_name, extversion AS version
      FROM pg_extension
      ORDER BY extension_name`,
  )
  return rows
}

export type CatalogFunctionRow = {
  function_name: string
  identity_arguments: string
  definition: string
}

export async function readFunctions(query: CatalogQuery): Promise<CatalogFunctionRow[]> {
  const { rows } = await query<CatalogFunctionRow>(
    `/* readSchemaSnapshotFunctions */
      SELECT
        target.proname AS function_name,
        pg_get_function_identity_arguments(target.oid) AS identity_arguments,
        pg_get_functiondef(target.oid) AS definition
      FROM pg_proc target
      JOIN pg_namespace ON pg_namespace.oid = target.pronamespace
      WHERE pg_namespace.nspname = 'public'
        AND ${EXCLUDE_EXTENSION_OWNED}
      ORDER BY function_name, identity_arguments`,
  )
  return rows
}

export type CatalogPolicyRow = {
  table_name: string
  policy_name: string
  command: string
  pg_roles: string[]
  using_expression: string | null
  with_check_expression: string | null
}

export async function readPolicies(query: CatalogQuery): Promise<CatalogPolicyRow[]> {
  const { rows } = await query<CatalogPolicyRow>(
    `/* readSchemaSnapshotPolicies */
      SELECT
        tablename AS table_name,
        policyname AS policy_name,
        cmd AS command,
        roles AS pg_roles,
        qual AS using_expression,
        with_check AS with_check_expression
      FROM pg_policies
      WHERE schemaname = 'public'
      ORDER BY table_name, policy_name`,
  )
  return rows
}
