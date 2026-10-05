import type { NodeLike, VariableLike } from './ast-helpers.mts'

function isWithin(node: NodeLike, ancestor: NodeLike): boolean {
  let current: NodeLike | null | undefined = node
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

export function hasExternalWrite(variable: VariableLike, pattern: NodeLike): boolean {
  return variable.references.some(
    (reference) => !isWithin(reference.identifier, pattern) && reference.isWrite(),
  )
}
