import { patternPropertyName, staticPropertyName, unwrap, type NodeLike } from './ast-helpers.mts'

export function patternDefaultCanApply(
  pattern: NodeLike,
  localName: string,
  source: NodeLike | null | undefined,
  definitelyPresent?: (value: NodeLike) => boolean,
): boolean {
  if (pattern.type !== 'ObjectPattern' && pattern.type !== 'ArrayPattern') return false
  const entries = (
    pattern.type === 'ObjectPattern' ? pattern.properties : pattern.elements
  ) as Array<NodeLike | null>
  for (const [index, entry] of entries.entries()) {
    if (!entry) continue
    const value = (entry.value ?? entry) as NodeLike
    const entrySource = patternEntrySource(pattern, entry, index, source)
    if (value.type === 'AssignmentPattern' && (value.left as NodeLike).name === localName) {
      return !isDefinitelyPresent(entrySource, definitelyPresent)
    }
    const nested = patternDefaultCanApply(
      value.type === 'AssignmentPattern' ? (value.left as NodeLike) : value,
      localName,
      entrySource,
      definitelyPresent,
    )
    if (nested) return true
  }
  return false
}

function patternEntrySource(
  pattern: NodeLike,
  entry: NodeLike,
  index: number,
  source: NodeLike | null | undefined,
): NodeLike | null | undefined {
  const current = unwrap(source)
  if (pattern.type === 'ArrayPattern') {
    if (current?.type !== 'ArrayExpression') return undefined
    const elements = current.elements as Array<NodeLike | null>
    if (elements.slice(0, index + 1).some((element) => element?.type === 'SpreadElement')) {
      return undefined
    }
    return (elements[index] ?? null) as NodeLike | null
  }
  if (current?.type !== 'ObjectExpression') return undefined
  const name = patternPropertyName(entry)
  for (const candidate of (current.properties as NodeLike[]).toReversed()) {
    if (candidate.type !== 'Property') return undefined
    const candidateName = patternPropertyName(candidate)
    if (candidateName === null) return undefined
    if (candidateName === name) {
      return ['get', 'set'].includes(String(candidate.kind))
        ? undefined
        : (candidate.value as NodeLike)
    }
  }
  return null
}

function isDefinitelyPresent(
  value: NodeLike | null | undefined,
  additional?: (value: NodeLike) => boolean,
): boolean {
  const current = unwrap(value)
  if (!current) return false
  if (current.type === 'Identifier' && current.name === 'undefined') return false
  if (current.type === 'UnaryExpression' && current.operator === 'void') return false
  return (
    staticPropertyName(current) !== null ||
    [
      'ArrayExpression',
      'ArrowFunctionExpression',
      'ClassExpression',
      'FunctionExpression',
      'ObjectExpression',
    ].includes(current.type) ||
    Boolean(additional?.(current))
  )
}
