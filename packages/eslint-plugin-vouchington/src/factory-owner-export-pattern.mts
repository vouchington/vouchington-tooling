import {
  findVariable,
  patternPropertyName,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'

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
    if (name === null) return false
    if (factories.has(String(name))) return true
    if (name !== 'default') return false
    const value = property.value as NodeLike
    const selected = value.type === 'AssignmentPattern' ? (value.left as NodeLike) : value
    return selected.type === 'ObjectPattern' ? patternSelectsFactory(selected, factories) : true
  })
}

export function mutableExportInitializer(
  context: RuleContextLike,
  binding: NodeLike,
): NodeLike | undefined {
  const definition = findVariable(context, binding)?.defs.find(
    (entry) => entry.type === 'Variable' && entry.node.type === 'VariableDeclarator',
  )
  if (definition?.parent?.type !== 'VariableDeclaration' || definition.parent.kind === 'const') {
    return undefined
  }
  const declarator = definition.node
  return (declarator.id as NodeLike).type === 'Identifier'
    ? (declarator.init as NodeLike | undefined)
    : undefined
}
