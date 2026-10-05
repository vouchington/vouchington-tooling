import {
  findVariable,
  patternPropertyName,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'
import {
  namedPatternDefaultSource,
  namedPatternSource,
} from './factory-owner-provenance-binding.mts'
import { patternDefaultValue } from './factory-owner-pattern-default.mts'
import { hasExternalWrite, hasExternalWriteBefore } from './factory-owner-variable.mts'

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
    if (name === 'default')
      return selected.type === 'ObjectPattern'
        ? patternSelectsFactory(selected, factories)
        : selected.type !== 'ArrayPattern'
    return (
      factories.has(String(name)) &&
      selected.type !== 'ObjectPattern' &&
      selected.type !== 'ArrayPattern'
    )
  })
}

export function mutableExportInitializer(
  context: RuleContextLike,
  binding: NodeLike,
  factories: ReadonlySet<string>,
  boundary?: NodeLike,
): NodeLike | undefined {
  const variable = findVariable(context, binding)
  const definition = variable?.defs.find(
    (entry) => entry.type === 'Variable' && entry.node.type === 'VariableDeclarator',
  )
  if (definition?.parent?.type !== 'VariableDeclaration' || definition.parent.kind === 'const') {
    return undefined
  }
  const declarator = definition.node
  if (
    variable &&
    (boundary
      ? hasExternalWriteBefore(variable, declarator.id as NodeLike, boundary)
      : hasExternalWrite(variable, declarator.id as NodeLike))
  )
    return undefined
  if ((declarator.id as NodeLike).type === 'Identifier') {
    return declarator.init as NodeLike | undefined
  }
  return (
    patternDefaultValue(declarator.id as NodeLike, String(binding.name)) ??
    namedPatternDefaultSource(declarator.id as NodeLike, String(binding.name), factories) ??
    namedPatternSource(declarator, String(binding.name), factories) ??
    undefined
  )
}
