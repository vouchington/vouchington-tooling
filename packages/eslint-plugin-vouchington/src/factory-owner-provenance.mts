import {
  findVariable,
  patternPropertyName,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
  type VariableLike,
} from './ast-helpers.mts'
import {
  isNamedImport,
  isNamespaceImport,
  requiredModuleSpecifier,
} from './factory-owner-require.mts'

export type FactoryProvenanceOptions = {
  modules: ReadonlySet<string>
  factories: ReadonlySet<string>
}

function node(value: unknown): NodeLike | undefined {
  return value !== null && typeof value === 'object' && 'type' in value
    ? (value as NodeLike)
    : undefined
}

function staticModuleSpecifier(value: NodeLike | undefined): string | null {
  return value?.type === 'Literal' && typeof value.value === 'string' ? value.value : null
}

function constantDefinition(variable: VariableLike | null): NodeLike | null {
  const definition = variable?.defs.find((entry) => entry.type === 'Variable')
  if (!definition || definition.node.type !== 'VariableDeclarator') return null
  return definition.parent?.type === 'VariableDeclaration' && definition.parent.kind === 'const'
    ? definition.node
    : null
}

function namedPatternSource(
  declarator: NodeLike,
  localName: string,
  names: ReadonlySet<string>,
): NodeLike | null {
  const pattern = node(declarator.id)
  if (pattern?.type !== 'ObjectPattern') return null
  const properties = pattern.properties as NodeLike[]
  return properties.some((property) => {
    const local = node(property.value)
    return (
      property.type === 'Property' &&
      local?.type === 'Identifier' &&
      local.name === localName &&
      names.has(String(patternPropertyName(property)))
    )
  })
    ? (node(declarator.init) ?? null)
    : null
}

export function createFactoryProvenance(
  context: RuleContextLike,
  options: FactoryProvenanceOptions,
): {
  isFactory: (value: NodeLike | null | undefined) => boolean
  isNamespace: (value: NodeLike | null | undefined) => boolean
} {
  function isNamespace(
    value: NodeLike | null | undefined,
    active = new Set<VariableLike>(),
  ): boolean {
    const current = unwrap(value)
    if (current?.type === 'AwaitExpression') return isNamespace(node(current.argument), active)
    if (current?.type === 'ImportExpression') {
      const moduleName = staticModuleSpecifier(node(current.source))
      return moduleName !== null && options.modules.has(moduleName)
    }
    if (current?.type === 'CallExpression') {
      const moduleName = requiredModuleSpecifier(context, current)
      return moduleName !== null && options.modules.has(moduleName)
    }
    if (current?.type !== 'Identifier') return false
    if (isNamespaceImport(context, current, options.modules)) return true
    const variable = findVariable(context, current)
    if (!variable || active.has(variable)) return false
    const declarator = constantDefinition(variable)
    if (!declarator || node(declarator.id)?.type !== 'Identifier') return false
    active.add(variable)
    try {
      return isNamespace(node(declarator.init), active)
    } finally {
      active.delete(variable)
    }
  }

  function isFactory(
    value: NodeLike | null | undefined,
    active = new Set<VariableLike>(),
  ): boolean {
    const current = unwrap(value)
    if (current?.type === 'MemberExpression') {
      return (
        options.factories.has(String(propertyName(current))) && isNamespace(node(current.object))
      )
    }
    if (current?.type !== 'Identifier') return false
    if (
      [...options.factories].some((name) => isNamedImport(context, current, options.modules, name))
    )
      return true
    const variable = findVariable(context, current)
    if (!variable || active.has(variable)) return false
    const declarator = constantDefinition(variable)
    if (!declarator) return false
    const patternSource = namedPatternSource(declarator, String(current.name), options.factories)
    if (patternSource) return isNamespace(patternSource)
    if (node(declarator.id)?.type !== 'Identifier') return false
    active.add(variable)
    try {
      return isFactory(node(declarator.init), active)
    } finally {
      active.delete(variable)
    }
  }

  return { isFactory, isNamespace }
}
