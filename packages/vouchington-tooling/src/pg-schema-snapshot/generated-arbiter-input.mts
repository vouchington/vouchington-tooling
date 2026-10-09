import type { PostgresSqlConflict, PostgresSqlExpression, PostgresSqlName } from 'no-mistakes'

export type GeneratedArbiterAssignmentInput = {
  columns: readonly string[]
  /** A direct column reference, excluding the two-part EXCLUDED namespace. */
  referencedColumn: string | undefined
  hasIndirection: boolean
  complete: boolean
}

export type GeneratedArbiterInput = {
  action: 'doNothing' | 'doUpdate'
  /** Undefined for named constraints, omitted keys, or unresolved expression keys. */
  keyColumns: ReadonlySet<string> | undefined
  predicateColumns: ReadonlySet<string>
  assignments: readonly GeneratedArbiterAssignmentInput[]
  /** False means callers must reject rather than infer replay safety from partial facts. */
  complete: boolean
}

/** Projects released SQL facts for a snapshot-dependent generated-column replay verdict.
 * This reports syntax and identities only; callers own protection and safety policy.
 */
export function projectGeneratedArbiterInput(conflict: PostgresSqlConflict): GeneratedArbiterInput {
  let complete = true
  const predicateColumns = new Set<string>()
  if (conflict.predicate) {
    complete = expressionComplete(conflict.predicate)
    collectColumns(conflict.predicate, predicateColumns)
  }
  let keyColumns: Set<string> | undefined
  if (conflict.target.kind === 'columns' && conflict.target.columns.length > 0) {
    keyColumns = new Set(conflict.target.columns.map((column) => column.identity))
  } else if (conflict.target.kind === 'expressions') {
    const columns = new Set<string>()
    let resolved = conflict.target.expressions.length > 0
    for (const expression of conflict.target.expressions) {
      const references = new Set<string>()
      collectColumns(expression, references)
      const represented = expressionComplete(expression)
      complete &&= represented
      if (!represented || references.size !== 1) resolved = false
      for (const column of references) columns.add(column)
    }
    if (resolved) keyColumns = columns
  }
  const assignments =
    conflict.action.kind === 'doUpdate'
      ? conflict.action.assignments.map((assignment) => {
          const columns = assignment.columns.map(lastIdentity)
          const represented =
            assignment.complete &&
            columns.every((column) => column !== undefined) &&
            expressionComplete(assignment.expression)
          complete &&= represented
          const root = assignment.expression.root
          return {
            columns: columns.filter((column): column is string => column !== undefined),
            referencedColumn:
              root.kind === 'columnReference' && !isExcluded(root.name)
                ? lastIdentity(root.name)
                : undefined,
            hasIndirection: Boolean(
              assignment.target &&
              (assignment.target.subscripts.length > 0 ||
                (assignment.target.indirection?.length ?? 0) > 0),
            ),
            complete: represented,
          }
        })
      : []
  return { action: conflict.action.kind, keyColumns, predicateColumns, assignments, complete }
}

function lastIdentity(name: PostgresSqlName): string | undefined {
  return name.parts.at(-1)?.identity
}

function isExcluded(name: PostgresSqlName): boolean {
  return name.parts.length === 2 && name.parts[0]?.identity === 'excluded'
}

function collectColumns(expression: PostgresSqlExpression, columns: Set<string>): void {
  for (const name of expression.columns) {
    const column = lastIdentity(name)
    if (!isExcluded(name) && column !== undefined) columns.add(column)
  }
}

function expressionComplete(expression: PostgresSqlExpression): boolean {
  // Older optional peers do not carry completeness; do not silently admit their partial facts.
  return (
    'childrenComplete' in expression &&
    expression.childrenComplete === true &&
    expression.columns.every((name) => lastIdentity(name) !== undefined)
  )
}
