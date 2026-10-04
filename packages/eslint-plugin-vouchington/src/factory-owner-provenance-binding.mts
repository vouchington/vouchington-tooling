import {
  findVariable,
  patternPropertyName,
  staticPropertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
  type VariableLike,
} from './ast-helpers.mts'

function staticModuleSpecifier(value: NodeLike | null | undefined): string | null {
  const name = staticPropertyName(value)
  return typeof name === 'string' ? name : null
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
  if (current?.type === 'ImportExpression')
    return staticModuleSpecifier(unwrap(current.source as NodeLike))
  if (current?.type === 'SequenceExpression')
    return awaitedModuleSpecifier(context, (current.expressions as NodeLike[]).at(-1), active)
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
  return patternHasBinding(pattern, localName, names) ? (declarator.init as NodeLike) : null
}

export function patternDefaultValue(pattern: NodeLike, localName: string): NodeLike | null {
  if (pattern.type !== 'ObjectPattern') return null
  for (const property of pattern.properties as NodeLike[]) {
    if (property.type !== 'Property') continue
    const value = property.value as NodeLike
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
    return [pattern.right as NodeLike, ...patternDefaultValues(pattern.left as NodeLike)]
  }
  if (pattern.type !== 'ObjectPattern' && pattern.type !== 'ArrayPattern') return []
  const entries = (
    pattern.type === 'ObjectPattern' ? pattern.properties : pattern.elements
  ) as Array<NodeLike | null>
  return entries.flatMap((entry) =>
    entry ? patternDefaultValues((entry.value ?? entry.argument ?? entry) as NodeLike) : [],
  )
}

function patternHasBinding(
  pattern: NodeLike,
  localName: string,
  names: ReadonlySet<string>,
): boolean {
  return (pattern.properties as NodeLike[]).some((property) => {
    const value = property.value as NodeLike
    const local = value?.type === 'AssignmentPattern' ? (value.left as NodeLike) : value
    const name = patternPropertyName(property)
    return (
      property.type === 'Property' &&
      ((local?.type === 'Identifier' &&
        local.name === localName &&
        name !== null &&
        names.has(String(name))) ||
        (name === 'default' &&
          local?.type === 'ObjectPattern' &&
          patternHasBinding(local, localName, names)))
    )
  })
}
