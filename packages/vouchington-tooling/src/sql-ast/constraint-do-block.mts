import type { AlterTableStmt, DoStmt } from '@libpg-query/parser'

import {
  fkAttrNames,
  foreignKeyFromConstraint,
  type SqlMigrationConstraintMetadata,
} from './constraint-shared.mts'
import { parseSql } from './parser.mts'

/**
 * Applies AT_AddConstraint / AT_ValidateConstraint commands from one ALTER TABLE to `result`.
 *
 * `trackConstraintValidation` gates NOT VALID/VALIDATE pairing bookkeeping. Callers that
 * parse ALTER TABLE text out of a DO body should pass false so only `foreignKeys` is filled.
 */
export function processAlterTableStmt(
  statement: AlterTableStmt,
  baseOffset: number,
  result: SqlMigrationConstraintMetadata,
  trackConstraintValidation = true,
): void {
  const tableName = statement.relation?.relname
  /* v8 ignore next */
  if (!tableName) return
  for (const rawCommand of statement.cmds ?? []) {
    /* v8 ignore next */
    if (!rawCommand || !('AlterTableCmd' in rawCommand)) continue
    const command = rawCommand.AlterTableCmd
    if (command.subtype === 'AT_ValidateConstraint' && command.name) {
      if (trackConstraintValidation) result.validatedConstraints.add(`${tableName}.${command.name}`)
      continue
    }
    /* v8 ignore next */
    if (command.subtype !== 'AT_AddConstraint') continue
    const definition = command.def
    /* v8 ignore next */
    if (!definition || !('Constraint' in definition)) continue
    const constraint = definition.Constraint
    /* v8 ignore next */
    if (!constraint) continue
    if (constraint.contype === 'CONSTR_FOREIGN') {
      // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- isolate the generated AST type escape at the foreign-key adapter boundary
      const constraintRecord = constraint as unknown as Record<string, unknown>
      result.foreignKeys.push(
        foreignKeyFromConstraint(
          constraintRecord,
          tableName,
          fkAttrNames(constraintRecord),
          baseOffset,
        ),
      )
    }
    if (!trackConstraintValidation) continue
    /* v8 ignore next */
    if (constraint.contype !== 'CONSTR_CHECK' && constraint.contype !== 'CONSTR_FOREIGN') continue
    result.addedConstraints.push({
      /* v8 ignore next 3 */
      constraintType: constraint.contype ?? null,
      location: baseOffset + (constraint.location ?? 0),
      name: constraint.conname ?? null,
      tableName,
    })
  }
}

const ALTER_TABLE_STATEMENT_RE = /ALTER\s+TABLE\b[^;]*;/gi

/** Idempotent migrations wrap `ALTER TABLE ... ADD CONSTRAINT` in `DO $$ ... $$` catalog checks. */
/* v8 ignore start -- DO-body regex/parse fallbacks */
export function collectDoStmtConstraints(
  content: string,
  statement: DoStmt,
  stmtLocation: number,
  result: SqlMigrationConstraintMetadata,
): void {
  for (const arg of statement.args ?? []) {
    const defElem = arg && 'DefElem' in arg ? arg.DefElem : undefined
    const stringArg = defElem?.arg && 'String' in defElem.arg ? defElem.arg.String : undefined
    const body = typeof stringArg?.sval === 'string' ? stringArg.sval : ''
    for (const match of body.matchAll(ALTER_TABLE_STATEMENT_RE)) {
      const baseOffset = content.indexOf(match[0], stmtLocation)
      /* v8 ignore next */
      if (baseOffset === -1) continue
      let nested: ReturnType<typeof parseSql>
      try {
        nested = parseSql(match[0])
      } catch {
        /* v8 ignore next */
        continue
      }
      for (const nestedStmt of nested.stmts ?? []) {
        const node = nestedStmt.stmt
        if (node && 'AlterTableStmt' in node) {
          processAlterTableStmt(node.AlterTableStmt, baseOffset, result, false)
        }
      }
    }
  }
}
/* v8 ignore stop */
