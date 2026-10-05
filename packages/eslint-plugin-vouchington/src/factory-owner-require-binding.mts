import { findVariable, type NodeLike, type RuleContextLike } from './ast-helpers.mts'
import { patternDefaultValue } from './factory-owner-pattern-default.mts'

export function requireBindingSource(
  context: RuleContextLike,
  identifier: NodeLike,
): NodeLike | null {
  const declarator = findVariable(context, identifier)?.defs.find(
    (definition) => definition.type === 'Variable' && definition.node.type === 'VariableDeclarator',
  )?.node
  if (!declarator) return null
  const id = declarator.id as NodeLike
  return id.type === 'Identifier'
    ? (declarator.init as NodeLike)
    : patternDefaultValue(id, String(identifier.name))
}
