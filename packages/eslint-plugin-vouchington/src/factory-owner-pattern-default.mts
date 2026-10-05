import type { NodeLike } from './ast-helpers.mts'

function patternEntries(pattern: NodeLike): Array<NodeLike | null> {
  return (
    pattern.type === 'ObjectPattern' ? pattern.properties : pattern.elements
  ) as Array<NodeLike | null>
}

export function patternDefaultValue(pattern: NodeLike, localName: string): NodeLike | null {
  if (pattern.type !== 'ObjectPattern' && pattern.type !== 'ArrayPattern') return null
  for (const entry of patternEntries(pattern)) {
    if (!entry) continue
    const value = (entry.value ?? entry) as NodeLike
    if (value.type === 'AssignmentPattern' && (value.left as NodeLike).name === localName) {
      return value.right as NodeLike
    }
    const nested = patternDefaultValue(
      value.type === 'AssignmentPattern' ? (value.left as NodeLike) : value,
      localName,
    )
    if (nested) return nested
  }
  return null
}

export function patternDefaultValues(pattern: NodeLike): NodeLike[] {
  if (pattern.type === 'AssignmentPattern') {
    const left = pattern.left as NodeLike
    return [
      ...(left.type === 'Identifier' ? [pattern.right as NodeLike] : []),
      ...patternDefaultValues(left),
    ]
  }
  if (pattern.type !== 'ObjectPattern' && pattern.type !== 'ArrayPattern') return []
  return patternEntries(pattern).flatMap((entry) =>
    entry ? patternDefaultValues((entry.value ?? entry.argument ?? entry) as NodeLike) : [],
  )
}
