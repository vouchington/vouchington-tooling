import type { NodeLike, VariableLike } from './ast-helpers.mts'

export function valueImportEqualsSource(variable: VariableLike): NodeLike | null {
  const declaration = variable.defs.find(
    (entry) =>
      entry.node.type === 'TSImportEqualsDeclaration' &&
      entry.node.importKind !== 'type' &&
      !entry.node.isTypeOnly,
  )?.node
  return (declaration?.moduleReference as NodeLike | undefined) ?? null
}
