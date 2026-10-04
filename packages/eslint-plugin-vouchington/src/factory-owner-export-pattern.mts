import { patternPropertyName, type NodeLike } from './ast-helpers.mts'

export function bindingNodes(value: NodeLike): NodeLike[] {
  if (value.type === 'AssignmentPattern') return bindingNodes(value.left as NodeLike)
  if (value.type === 'ObjectPattern')
    return (value.properties as NodeLike[]).flatMap((property) =>
      bindingNodes((property.value ?? property.argument) as NodeLike),
    )
  return [value]
}

export function patternSelectsFactory(pattern: NodeLike, factories: ReadonlySet<string>): boolean {
  if (pattern.type !== 'ObjectPattern') return false
  return (pattern.properties as NodeLike[]).some((property) => {
    if (property.type !== 'Property') return false
    const name = patternPropertyName(property)
    return name === 'default' || (name !== null && factories.has(String(name)))
  })
}
