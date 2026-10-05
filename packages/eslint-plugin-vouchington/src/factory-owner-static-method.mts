import { patternPropertyName, propertyName, unwrap, type NodeLike } from './ast-helpers.mts'

export function isStaticMethod(value: NodeLike): boolean {
  if (value.type !== 'MemberExpression') return false
  const object = unwrap(value.object as NodeLike)
  if (object?.type !== 'ObjectExpression') return false
  const name = propertyName(value)
  for (const property of (object.properties as NodeLike[]).toReversed()) {
    if (property.type !== 'Property') return false
    const candidateName = patternPropertyName(property)
    if (candidateName === null) return false
    if (candidateName === name) return Boolean(property.method)
  }
  return false
}
