import { isRecord } from './unknown-record.mts'

export type SqlMigrationConstraintMetadata = {
  addedConstraints: Array<{
    constraintType: string | null
    location: number
    name: string | null
    tableName: string
  }>
  foreignKeys: Array<{
    columnNames: string[]
    deleteAction: string | null
    location: number
    referencedTableName: string | null
    tableName: string | null
  }>
  validatedConstraints: Set<string>
}

export type ForeignKey = SqlMigrationConstraintMetadata['foreignKeys'][number]

export function fkAttrNames(constraint: Record<string, unknown>): string[] {
  const attrs = constraint.fk_attrs
  if (!Array.isArray(attrs)) return []
  return attrs.flatMap((attr) => {
    const sval = isRecord(attr) && isRecord(attr.String) ? attr.String.sval : undefined
    return typeof sval === 'string' ? [sval] : []
  })
}

export function foreignKeyFromConstraint(
  constraint: Record<string, unknown>,
  tableName: string | null,
  columnNames: string[],
  baseOffset = 0,
): ForeignKey {
  const pktable = constraint.pktable
  return {
    columnNames,
    deleteAction: typeof constraint.fk_del_action === 'string' ? constraint.fk_del_action : null,
    location: baseOffset + (typeof constraint.location === 'number' ? constraint.location : 0),
    referencedTableName:
      isRecord(pktable) && typeof pktable.relname === 'string' ? pktable.relname : null,
    tableName,
  }
}
