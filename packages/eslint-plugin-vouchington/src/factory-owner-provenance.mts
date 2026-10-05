import {
  findVariable,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
  type VariableLike,
} from './ast-helpers.mts'
import {
  awaitedModuleSpecifier,
  constantDefinition,
  namedPatternDefaultSource,
  namedPatternSource,
} from './factory-owner-provenance-binding.mts'
import { patternDefaultValue } from './factory-owner-pattern-default.mts'
import { withActiveVariable } from './factory-owner-recursion.mts'
import { isFactoryMember } from './factory-owner-member.mts'
import { isNamespacePatternBinding } from './factory-owner-namespace-pattern.mts'
import {
  isConfiguredFactoryImport,
  isNamespaceImport,
  requiredModuleSpecifier,
} from './factory-owner-require.mts'
import { isQualifiedImportFactory } from './factory-owner-qualified-import.mts'

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
    if (current?.type === 'SequenceExpression')
      return isNamespace((current.expressions as NodeLike[]).at(-1), active)
    if (current?.type === 'AwaitExpression') {
      const argument = unwrap(current.argument as NodeLike)
      const moduleName = awaitedModuleSpecifier(context, argument)
      return moduleName !== null ? options.modules.has(moduleName) : isNamespace(argument, active)
    }
    if (current?.type === 'MemberExpression') {
      return propertyName(current) === 'default' && isNamespace(current.object as NodeLike, active)
    }
    if (current?.type === 'CallExpression') {
      const rawCallee = unwrap(current.callee as NodeLike) as NodeLike
      const callee =
        rawCallee.type === 'SequenceExpression'
          ? (unwrap((rawCallee.expressions as NodeLike[]).at(-1)) as NodeLike)
          : rawCallee
      const loader = findVariable(context, callee)
      const definition = loader?.defs.find((entry) => entry.type === 'Variable')
      if (
        definition &&
        loader?.references.some(
          (reference) => reference.identifier !== definition.node.id && reference.isWrite(),
        )
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
    const importAlias = variable.defs.find(
      (entry) => entry.node.type === 'TSImportEqualsDeclaration',
    )?.node.moduleReference as NodeLike | undefined
    if (importAlias?.type === 'Identifier') {
      return withActiveVariable(variable, active, () => isNamespace(importAlias, active))
    }
    const declarator = constantDefinition(variable)
    if (!declarator) return false
    return withActiveVariable(variable, active, () =>
      isNamespacePatternBinding(declarator, String(current.name), (value) =>
        isNamespace(value, active),
      ),
    )
  }

  function isFactory(
    value: NodeLike | null | undefined,
    active = new Set<VariableLike>(),
  ): boolean {
    const current = unwrap(value)
    if (current?.type === 'SequenceExpression')
      return isFactory((current.expressions as NodeLike[]).at(-1), active)
    if (current?.type === 'AwaitExpression') return isFactory(current.argument as NodeLike, active)
    if (current?.type === 'MemberExpression') {
      return isFactoryMember(current, options.factories, (value) => isNamespace(value))
    }
    if (current?.type !== 'Identifier') return false
    if (isConfiguredFactoryImport(context, current, options.modules, options.factories)) return true
    const variable = findVariable(context, current)
    if (!variable || active.has(variable)) return false
    if (
      isQualifiedImportFactory(context, current, options.factories, (value) => isNamespace(value))
    )
      return true
    const declarator = constantDefinition(variable)
    if (!declarator) return false
    return withActiveVariable(variable, active, () => {
      const defaultValue = patternDefaultValue(declarator.id as NodeLike, String(current.name))
      if (defaultValue && isFactory(defaultValue, active)) return true
      const defaultNamespace = namedPatternDefaultSource(
        declarator.id as NodeLike,
        String(current.name),
        options.factories,
      )
      if (defaultNamespace && isNamespace(defaultNamespace)) return true
      const patternSource = namedPatternSource(declarator, String(current.name), options.factories)
      if (patternSource) return isNamespace(patternSource)
      if ((declarator.id as NodeLike).type !== 'Identifier') return false
      return isFactory(declarator.init as NodeLike, active)
    })
  }

  return { isFactory, isNamespace }
}
