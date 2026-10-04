import {
  findVariable,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
  type VariableLike,
} from './ast-helpers.mts'
import {
  constantDefinition,
  namedPatternSource,
  staticModuleSpecifier,
} from './factory-owner-provenance-binding.mts'
import {
  isNamedImport,
  isNamespaceImport,
  requiredModuleSpecifier,
} from './factory-owner-require.mts'

export type FactoryProvenanceOptions = {
  modules: ReadonlySet<string>
  factories: ReadonlySet<string>
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
    if (current?.type === 'AwaitExpression') {
      const argument = unwrap(current.argument as NodeLike)
      if (argument?.type !== 'ImportExpression') return isNamespace(argument, active)
      const moduleName = staticModuleSpecifier(argument.source as NodeLike)
      return moduleName !== null && options.modules.has(moduleName)
    }
    if (current?.type === 'MemberExpression') {
      return propertyName(current) === 'default' && isNamespace(current.object as NodeLike, active)
    }
    if (current?.type === 'CallExpression') {
      const loader = findVariable(context, unwrap(current.callee as NodeLike) as NodeLike)
      const definition = loader?.defs.find((entry) => entry.type === 'Variable')
      if (
        definition?.parent?.type === 'VariableDeclaration' &&
        definition.parent.kind !== 'const'
      ) {
        return false
      }
      const moduleName = requiredModuleSpecifier(context, current)
      return moduleName !== null && options.modules.has(moduleName)
    }
    if (current?.type !== 'Identifier') return false
    if (isNamespaceImport(context, current, options.modules)) return true
    const variable = findVariable(context, current)
    if (!variable || active.has(variable)) return false
    const declarator = constantDefinition(variable)
    if (!declarator) return false
    active.add(variable)
    try {
      const defaultSource = namedPatternSource(
        declarator,
        String(current.name),
        new Set(['default']),
      )
      if (defaultSource) return isNamespace(defaultSource, active)
      if ((declarator.id as NodeLike).type !== 'Identifier') return false
      return isNamespace(declarator.init as NodeLike, active)
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
      const name = propertyName(current)
      return (
        name !== null &&
        options.factories.has(String(name)) &&
        isNamespace(current.object as NodeLike)
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
    if ((declarator.id as NodeLike).type !== 'Identifier') return false
    active.add(variable)
    try {
      return isFactory(declarator.init as NodeLike, active)
    } finally {
      active.delete(variable)
    }
  }

  return { isFactory, isNamespace }
}
