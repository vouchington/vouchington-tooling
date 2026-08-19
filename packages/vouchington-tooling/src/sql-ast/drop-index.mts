import { parseSql } from './parser.mts'
import { isRecord } from './unknown-record.mts'

export type SqlDropIndexMetadata = {
  idxname: string
  location: number
}

export function extractDropIndexMetadata(content: string): SqlDropIndexMetadata[] {
  const indexes: SqlDropIndexMetadata[] = []
  const parseResult = parseSql(content)

  for (const rawStmt of parseResult.stmts ?? []) {
    const node = rawStmt.stmt
    /* v8 ignore next 2 */
    if (!node || !('DropStmt' in node) || node.DropStmt.removeType !== 'OBJECT_INDEX') continue
    for (const object of node.DropStmt.objects ?? []) {
      const objectValue: unknown = object
      const items =
        isRecord(objectValue) && isRecord(objectValue['List'])
          ? objectValue['List']['items']
          : undefined
      if (!Array.isArray(items)) continue
      const names = items.flatMap((item) => {
        const itemValue: unknown = item
        const value =
          isRecord(itemValue) && isRecord(itemValue['String'])
            ? itemValue['String']['sval']
            : undefined
        return typeof value === 'string' ? [value] : []
      })
      const idxname = names.at(-1)
      if (idxname) indexes.push({ idxname, location: rawStmt.stmt_location ?? 0 })
    }
  }

  return indexes
}
