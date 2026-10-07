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
