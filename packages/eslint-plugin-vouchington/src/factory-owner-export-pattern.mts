import {
  findVariable,
  patternPropertyName,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'
import { namedPatternSource } from './factory-owner-provenance-binding.mts'
import { patternDefaultValue } from './factory-owner-pattern-default.mts'

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
    const value = property.value as NodeLike
    const selected = value.type === 'AssignmentPattern' ? (value.left as NodeLike) : value
    if (factories.has(String(name))) {
      return selected.type !== 'ObjectPattern' && selected.type !== 'ArrayPattern'
    }
    if (name !== 'default') return false
    return selected.type === 'ObjectPattern'
      ? patternSelectsFactory(selected, factories)
      : selected.type !== 'ArrayPattern'
  })
}

export function mutableExportInitializer(
  context: RuleContextLike,
  binding: NodeLike,
  factories: ReadonlySet<string>,
): NodeLike | undefined {
  const definition = findVariable(context, binding)?.defs.find(
    (entry) => entry.type === 'Variable' && entry.node.type === 'VariableDeclarator',
  )
  if (definition?.parent?.type !== 'VariableDeclaration' || definition.parent.kind === 'const') {
    return undefined
  }
  const declarator = definition.node
  if ((declarator.id as NodeLike).type === 'Identifier') {
    return declarator.init as NodeLike | undefined
  }
  return (
    patternDefaultValue(declarator.id as NodeLike, String(binding.name)) ??
    namedPatternSource(declarator, String(binding.name), factories) ??
    undefined
  )
}
