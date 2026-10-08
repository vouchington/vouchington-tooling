import { loadPostgresParser } from '../sql-ast/no-mistakes-peer.mts'
import type { SchemaSnapshot } from './types.mts'

/** Column references for one STORED generated expression, projected from parser facts. */
export type GeneratedColumnReferences = {
  table: string
  column: string
  sourceColumns: readonly string[]
}

export type PostgresReplayContext = {
  /** Unknown tables return undefined so callers can fail closed. */
  triggerTextsForTable(table: string): readonly string[] | undefined
  /** Memoized per table; unknown tables return undefined and empty dependency sets return an empty map. */
  generatedDependenciesForTable(table: string): ReadonlyMap<string, ReadonlySet<string>> | undefined
}

/** Collects generated-expression facts with the optional SQL peer, once per snapshot. */
export async function createPostgresReplayContextFromSchema(
  schema: SchemaSnapshot,
): Promise<PostgresReplayContext> {
  const definitions = Object.entries(schema.tables).flatMap(([table, snapshotTable]) =>
    Object.entries(snapshotTable.columns).flatMap(([column, definition]) =>
      definition.generated === 'stored' && definition.generatedExpression !== null
        ? [{ table, column, expression: definition.generatedExpression }]
        : [],
    ),
  )
  if (definitions.length === 0) {
    return createPostgresReplayContext({ schema, generatedColumnReferences: [] })
  }
  const { parsePostgresSql } = await loadPostgresParser('createPostgresReplayContextFromSchema')
  const parsed = await parsePostgresSql(
    definitions.map(({ table, column, expression }) => ({
      sql: `SELECT (${expression})`,
      fileName: `schema-snapshot:${table}.${column}`,
    })),
  )
  const generatedColumnReferences = definitions.map(({ table, column }, index) => {
    const facts = parsed[index]
    const statement = facts?.statements[0]
    if (
      !facts ||
      facts.diagnostics.length > 0 ||
      facts.statements.length !== 1 ||
      statement?.kind !== 'select' ||
      !statement.query.complete ||
      statement.query.unsupported.length > 0
    ) {
      throw new Error(`Unable to collect generated-column references for ${table}.${column}`)
    }
    return {
      table,
      column,
      sourceColumns: [
        ...new Set(
          statement.query.columns.map((reference) => reference.name.parts.at(-1)!.identity),
        ),
      ],
    }
  })
  return createPostgresReplayContext({ schema, generatedColumnReferences })
}

/**
 * Projects injected schema snapshot data and parser-derived generated-expression references for
 * replay checks. The caller owns snapshot loading and SQL parsing. Every STORED generated column
 * with an expression must have a corresponding reference fact, including expressions with no
 * column references; missing facts throw instead of silently weakening the caller's check.
 */
export function createPostgresReplayContext(input: {
  schema: SchemaSnapshot
  generatedColumnReferences: readonly GeneratedColumnReferences[]
}): PostgresReplayContext {
  const referenceFacts = new Map<string, ReadonlySet<string>>()
  for (const fact of input.generatedColumnReferences) {
    const key = generatedColumnKey(fact.table, fact.column)
    referenceFacts.set(key, new Set(fact.sourceColumns))
  }

  const dependencyCache = new Map<string, ReadonlyMap<string, ReadonlySet<string>>>()
  return {
    triggerTextsForTable(table) {
      const snapshotTable = input.schema.tables[table]
      return snapshotTable ? Object.values(snapshotTable.triggers) : undefined
    },
    generatedDependenciesForTable(table) {
      const cached = dependencyCache.get(table)
      if (cached) return cached
      const snapshotTable = input.schema.tables[table]
      if (!snapshotTable) return undefined
      const dependencies = new Map<string, ReadonlySet<string>>()
      for (const [column, definition] of Object.entries(snapshotTable.columns)) {
        if (definition.generated !== 'stored' || definition.generatedExpression === null) continue
        const key = generatedColumnKey(table, column)
        const sources = referenceFacts.get(key)
        if (!sources) {
          throw new Error(`Missing generated-column reference facts for ${table}.${column}`)
        }
        if (sources.size > 0) dependencies.set(column, sources)
      }
      dependencyCache.set(table, dependencies)
      return dependencies
    },
  }
}

function generatedColumnKey(table: string, column: string): string {
  return `${table}\0${column}`
}
