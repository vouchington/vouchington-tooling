import { parseSql } from './parser.mts'

export function extractAlterTableAddColumnLocations(content: string): number[] {
  const locations: number[] = []
  const parseResult = parseSql(content)

  for (const rawStmt of parseResult.stmts ?? []) {
    const node = rawStmt.stmt
    if (!node || !('AlterTableStmt' in node)) continue

    for (const rawCommand of node.AlterTableStmt.cmds ?? []) {
      if (!rawCommand || !('AlterTableCmd' in rawCommand)) continue
      const command = rawCommand.AlterTableCmd
      if (command.subtype !== 'AT_AddColumn') continue

      const definition = command.def
      if (!definition || !('ColumnDef' in definition)) continue
      locations.push(rawStmt.stmt_location ?? 0)
    }
  }

  return locations
}
