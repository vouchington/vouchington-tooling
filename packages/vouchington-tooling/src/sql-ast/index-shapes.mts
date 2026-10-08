import { readFile } from 'node:fs/promises'

async function loadParser() {
  const entry = import.meta.resolve('no-mistakes')
  const metadata: { version: string } = JSON.parse(
    await readFile(new URL('package.json', entry), 'utf8'),
  )
  const [major, minor] = metadata.version.split('.').map(Number)
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    major! < 0 ||
    (major === 0 && minor! < 81)
  ) {
    throw new Error('extractIndexShapes requires no-mistakes >=0.81.0')
  }
  return import('no-mistakes')
}

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
  const { parsePostgresSql } = await loadParser()
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
