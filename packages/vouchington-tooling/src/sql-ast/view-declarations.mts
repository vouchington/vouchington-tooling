import type { RangeVar } from '@libpg-query/parser'
import { isReservedSqlKeyword, isSqlParseError, parseSql } from './parser.mts'

export type ManagedViewDeclaration = {
  name: string
  type: 'materialized view' | 'view'
}

/**
 * Returns a PostgreSQL-quoted identifier. Simple lowercase non-keywords are returned unquoted;
 * keywords and names containing uppercase, spaces, punctuation, or other special characters
 * are wrapped in double-quotes with internal double-quotes escaped as "".
 */
function quotePgName(name: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(name) && !isReservedSqlKeyword(name)) return name
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Builds the qualified view reference (schema.view or just view) from the
 * unquoted identifiers the parser returns.
 */
function buildViewRef(view: RangeVar & { relname: string }): string {
  const name = quotePgName(view.relname)
  if (!view.schemaname) return name
  return `${quotePgName(view.schemaname)}.${name}`
}

/**
 * Extracts typed declarations from CREATE [OR REPLACE] VIEW and CREATE MATERIALIZED VIEW
 * statements in the given SQL string. Comments and string literals are ignored by the parser.
 *
 * Requires initSqlAst() to have resolved before the first call.
 */
export function extractViewDeclarations(sql: string): ManagedViewDeclaration[] {
  if (!sql.trim()) return []
  let result
  try {
    result = parseSql(sql)
  } catch (error) {
    if (isSqlParseError(error)) return []
    throw error
  }
  const declarations: ManagedViewDeclaration[] = []
  for (const stmt of result.stmts ?? []) {
    const node = stmt.stmt
    if (!node) continue
    if ('ViewStmt' in node) {
      const view = node.ViewStmt.view
      if (view?.relname) {
        declarations.push({
          name: buildViewRef(view as RangeVar & { relname: string }),
          type: 'view',
        })
      }
      continue
    }
    if ('CreateTableAsStmt' in node && node.CreateTableAsStmt.objtype === 'OBJECT_MATVIEW') {
      const view = node.CreateTableAsStmt.into?.rel
      if (view?.relname) {
        declarations.push({
          name: buildViewRef(view as RangeVar & { relname: string }),
          type: 'materialized view',
        })
      }
    }
  }
  return declarations
}
