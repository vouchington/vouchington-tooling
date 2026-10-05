import { patternPropertyName, propertyName, unwrap, type NodeLike } from './ast-helpers.mts'

export function isStaticMethod(value: NodeLike): boolean {
  if (value.type !== 'MemberExpression') return false
  const object = unwrap(value.object as NodeLike)
  if (object?.type !== 'ObjectExpression') return false
  const name = propertyName(value)
  return (object.properties as NodeLike[]).some(
    (property) =>
      property.type === 'Property' && property.method && patternPropertyName(property) === name,
  )
}
