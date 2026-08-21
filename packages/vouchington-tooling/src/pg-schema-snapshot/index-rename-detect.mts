export type SchemaIndexRenameSnapshot = {
  tables: Record<string, { indexes: Record<string, { definition: string }> }>
}

/**
 * Removes the index name from a `pg_get_indexdef()` definition, leaving a byte-exact "shape key"
 * for comparing two index definitions on identity (uniqueness, table, `ON ONLY`, access method,
 * key columns, `INCLUDE`, opclasses, `WHERE`) while ignoring only the name.
 *
 * Locates the name by offset rather than by regex: it finds the first ` INDEX ` (present exactly
 * once, since nothing before it in `CREATE [UNIQUE] INDEX ...` can contain that substring), then
 * confirms the token immediately after is exactly `name` or `"name"`. Throws if neither matches —
 * a caller that silently skipped an unrecognized definition would mask a real collision instead of
 * reporting one.
 */
export function indexShapeKey(name: string, definition: string): string {
  const marker = ' INDEX '
  const markerIndex = definition.indexOf(marker)
  if (markerIndex === -1) {
    throw new Error(
      `indexShapeKey: could not find ${JSON.stringify(marker)} in index definition: ${definition}`,
    )
  }
  const nameStart = markerIndex + marker.length
  const quotedName = `"${name}"`
  const bareNameEnd = nameStart + name.length
  const nameEnd = definition.startsWith(quotedName, nameStart)
    ? nameStart + quotedName.length
    : definition.startsWith(name, nameStart) &&
        (bareNameEnd === definition.length || !/[a-zA-Z0-9_"]/.test(definition[bareNameEnd]!))
      ? bareNameEnd
      : null
  if (nameEnd === null) {
    throw new Error(
      `indexShapeKey: index name ${JSON.stringify(name)} does not match the token following ${JSON.stringify(marker)} in: ${definition}`,
    )
  }
  return `${definition.slice(0, nameStart)}<name>${definition.slice(nameEnd)}`
}

export type RenamedIndex = {
  table: string
  retiredName: string
  retiredDefinition: string
  renamedTo: string
}

/**
 * Detects indexes present at `base` whose name is gone at `head` but whose physical shape
 * reappears under a different name — the cross-revision rename case that a single-revision
 * shape scan structurally cannot see.
 *
 * Scope is renames only: a base index whose name simply disappears with no shape match at head
 * (dropped outright, not renamed) is not reported.
 *
 * Index names are schema-unique in PostgreSQL, so a flat name set (rather than a per-table one)
 * is sufficient to know whether a name survived into head.
 */
export function detectRenamedIndexes({
  base,
  head,
}: {
  base: SchemaIndexRenameSnapshot
  head: SchemaIndexRenameSnapshot
}): RenamedIndex[] {
  const headNames = new Set<string>()
  const headNamesByShape = new Map<string, string[]>()
  for (const table of Object.values(head.tables)) {
    for (const [name, index] of Object.entries(table.indexes)) {
      headNames.add(name)
      const shapeKey = indexShapeKey(name, index.definition)
      const namesForShape = headNamesByShape.get(shapeKey)
      if (namesForShape) namesForShape.push(name)
      else headNamesByShape.set(shapeKey, [name])
    }
  }

  const renames: RenamedIndex[] = []
  for (const [tableName, table] of Object.entries(base.tables)) {
    for (const [retiredName, retiredIndex] of Object.entries(table.indexes)) {
      if (headNames.has(retiredName)) continue
      const retiredDefinition = retiredIndex.definition
      const shapeKey = indexShapeKey(retiredName, retiredDefinition)
      const renamedCandidates = headNamesByShape.get(shapeKey) ?? []
      for (const renamedTo of renamedCandidates) {
        renames.push({ table: tableName, retiredName, retiredDefinition, renamedTo })
      }
    }
  }
  return renames
}
