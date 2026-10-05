import {
  findVariable,
  patternPropertyName,
  staticPropertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
  type VariableLike,
} from './ast-helpers.mts'
import { patternDefaultValue } from './factory-owner-pattern-default.mts'

function staticModuleSpecifier(value: NodeLike | null | undefined): string | null {
  const current = unwrap(value)
  if (current?.type === 'UnaryExpression' && ['+', '-'].includes(String(current.operator))) {
    const operand = staticPropertyName(current.argument as NodeLike)
    if (typeof operand === 'number') return String(current.operator === '-' ? -operand : +operand)
    if (typeof operand === 'bigint' && current.operator === '-') return String(-operand)
    return null
  }
  const name = staticPropertyName(current)
  return name === null ? null : String(name)
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
  if (!declaration) return null
  const id = declaration.id as NodeLike
  const source =
    id.type === 'Identifier'
      ? (declaration.init as NodeLike)
      : patternDefaultValue(id, String(current.name))
  if (!source) return null
  active.add(variable)
  try {
    return awaitedModuleSpecifier(context, source, active)
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

export function namedPatternDefaultSource(
  pattern: NodeLike,
  localName: string,
  names: ReadonlySet<string>,
): NodeLike | null {
  if (pattern.type !== 'ObjectPattern') return null
  for (const property of pattern.properties as NodeLike[]) {
    const value = property.value as NodeLike
    if (value?.type === 'AssignmentPattern') {
      const left = value.left as NodeLike
      if (left.type === 'ObjectPattern' && patternHasBinding(left, localName, names)) {
        return value.right as NodeLike
      }
    }
    const source = value ? namedPatternDefaultSource(value, localName, names) : null
    if (source) return source
  }
  return null
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
