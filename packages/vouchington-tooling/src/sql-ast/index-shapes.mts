import { loadPostgresParser } from './no-mistakes-peer.mts'

/**
 * Returns collision keys for named top-level CREATE INDEX statements using released SQL facts.
 * Effective ordering, expressions, predicates, operator classes, and INCLUDE columns participate
 * in the upstream structural identity. DO blocks remain opaque to this top-level projection.
 * Any parse diagnostic rejects the complete input instead of returning partial collision facts.
 */
export async function extractIndexShapes(
  sql: string,
): Promise<{ idxname: string; table: string; shapeKey: string }[]> {
  if (!sql.trim()) return []
  const { parsePostgresSql } = await loadPostgresParser('extractIndexShapes')
  const facts = await parsePostgresSql({ sql })
  if (facts.diagnostics.length > 0) {
    throw new Error(
      `SQL syntax error: ${facts.diagnostics.map(({ message }) => message).join('; ')}`,
    )
  }
  return facts.statements.flatMap((statement) => {
    if (statement.kind !== 'createIndex' || !statement.index.name) return []
    const { index } = statement
    return [
      {
        idxname: index.name!.parts.at(-1)!.value,
        table: index.table.parts.at(-1)!.value,
        shapeKey: index.structuralIdentity,
      },
    ]
  })
}
