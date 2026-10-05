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

export function hasExternalWriteBefore(
  variable: VariableLike,
  pattern: NodeLike,
  boundary: NodeLike,
): boolean {
  if (!boundary.range) return hasExternalWrite(variable, pattern)
  const boundaryStart = (boundary.range as [number, number])[0]
  return variable.references.some((reference) => {
    const identifier = reference.identifier
    return (
      !isWithin(identifier, pattern) &&
      reference.isWrite() &&
      (!identifier.range || (identifier.range as [number, number])[0] < boundaryStart)
    )
  })
}
