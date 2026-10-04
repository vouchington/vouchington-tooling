import {
  findVariable,
  patternPropertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
  type VariableLike,
} from './ast-helpers.mts'

function staticModuleSpecifier(value: NodeLike | undefined): string | null {
  return value?.type === 'Literal' && typeof value.value === 'string' ? value.value : null
}

export function constantDefinition(variable: VariableLike | null): NodeLike | null {
  const definition = variable?.defs.find((entry) => entry.type === 'Variable')
  if (!definition || definition.node.type !== 'VariableDeclarator') return null
  return definition.parent?.type === 'VariableDeclaration' && definition.parent.kind === 'const'
    ? definition.node
    : null
}

export function awaitedModuleSpecifier(
  context: RuleContextLike,
  value: NodeLike | null | undefined,
  active = new Set<VariableLike>(),
): string | null {
  const current = unwrap(value)
  if (current?.type === 'ImportExpression') return staticModuleSpecifier(current.source as NodeLike)
  if (current?.type !== 'Identifier') return null
  const variable = findVariable(context, current)
  if (!variable || active.has(variable)) return null
  const declaration = constantDefinition(variable)
  if ((declaration?.id as NodeLike | undefined)?.type !== 'Identifier') return null
  active.add(variable)
  try {
    return awaitedModuleSpecifier(context, declaration?.init as NodeLike, active)
  } finally {
    active.delete(variable)
  }
}

export function namedPatternSource(
  declarator: NodeLike,
  localName: string,
  names: ReadonlySet<string>,
): NodeLike | null {
  const pattern = declarator.id as NodeLike
  if (pattern?.type !== 'ObjectPattern') return null
  const properties = pattern.properties as NodeLike[]
  return properties.some((property) => {
    const value = property.value as NodeLike
    const local = value?.type === 'AssignmentPattern' ? (value.left as NodeLike) : value
    const name = patternPropertyName(property)
    return (
      property.type === 'Property' &&
      local?.type === 'Identifier' &&
      local.name === localName &&
      name !== null &&
      names.has(String(name))
    )
  })
    ? (declarator.init as NodeLike)
    : null
}
