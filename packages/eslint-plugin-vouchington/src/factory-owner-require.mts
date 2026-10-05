import {
  findVariable,
  propertyName,
  staticPropertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'
import { isQualifiedCreateRequireAlias } from './factory-owner-create-require-alias.mts'
import { requireBindingSource } from './factory-owner-require-binding.mts'

export function isValueImportEquals(declaration: NodeLike): boolean {
  return declaration.importKind !== 'type' && !declaration.isTypeOnly
}

export function normalizeRequireLoader(node: NodeLike | null | undefined): NodeLike | undefined {
  const current = unwrap(node) ?? undefined
  if (current?.type === 'AwaitExpression')
    return normalizeRequireLoader(current.argument as NodeLike)
  if (current?.type === 'SequenceExpression')
    return normalizeRequireLoader((current.expressions as NodeLike[]).at(-1))
  return current
}

const NODE_MODULE_SPECIFIERS = new Set(['module', 'node:module'])

function importedName(specifier: NodeLike | undefined): string | undefined {
  const imported = specifier?.imported as NodeLike | undefined
  if (typeof imported?.name === 'string') return imported.name
  if (typeof imported?.value === 'string') return imported.value
  return undefined
}

function hasImport(
  context: RuleContextLike,
  identifier: NodeLike | null | undefined,
  sourceValues: ReadonlySet<string>,
  specifierTypes: ReadonlySet<string>,
  expectedImported?: string,
): boolean {
  if (identifier?.type !== 'Identifier') return false
  return Boolean(
    findVariable(context, identifier)?.defs?.some((definition) => {
      const specifier = definition.node
      const declaration = (definition.parent || specifier?.parent) as NodeLike | undefined
      return (
        definition.type === 'ImportBinding' &&
        specifierTypes.has(specifier.type) &&
        specifier.importKind !== 'type' &&
        declaration?.type === 'ImportDeclaration' &&
        declaration.importKind !== 'type' &&
        typeof declaration.source === 'object' &&
        sourceValues.has(String((declaration.source as NodeLike).value)) &&
        (expectedImported === undefined || importedName(specifier) === expectedImported)
      )
    }),
  )
}

export function isNamedImport(
  context: RuleContextLike,
  node: NodeLike | null | undefined,
  modules: ReadonlySet<string>,
  imported: string,
): boolean {
  return hasImport(context, unwrap(node), modules, new Set(['ImportSpecifier']), imported)
}

function isDefaultImport(
  context: RuleContextLike,
  node: NodeLike | null | undefined,
  modules: ReadonlySet<string>,
): boolean {
  return hasImport(context, unwrap(node), modules, new Set(['ImportDefaultSpecifier']))
}

export function isConfiguredFactoryImport(
  context: RuleContextLike,
  node: NodeLike,
  modules: ReadonlySet<string>,
  factories: ReadonlySet<string>,
): boolean {
  return (
    [...factories].some((name) => isNamedImport(context, node, modules, name)) ||
    (factories.has('default') && isDefaultImport(context, node, modules))
  )
}

export function isNamespaceImport(
  context: RuleContextLike,
  node: NodeLike | null | undefined,
  modules: ReadonlySet<string>,
): boolean {
  const value = unwrap(node)
  return (
    hasImport(
      context,
      value,
      modules,
      new Set(['ImportDefaultSpecifier', 'ImportNamespaceSpecifier']),
    ) ||
    hasImport(context, value, modules, new Set(['ImportSpecifier']), 'default') ||
    (value?.type === 'Identifier' &&
      Boolean(
        findVariable(context, value)?.defs.some((definition) => {
          const declaration = definition.node
          const reference = declaration?.moduleReference as NodeLike | undefined
          const specifier = reference?.expression as NodeLike | undefined
          return (
            declaration?.type === 'TSImportEqualsDeclaration' &&
            isValueImportEquals(declaration) &&
            reference?.type === 'TSExternalModuleReference' &&
            specifier?.type === 'Literal' &&
            typeof specifier.value === 'string' &&
            modules.has(specifier.value)
          )
        }),
      ))
  )
}

function isCreateRequireCall(context: RuleContextLike, node: NodeLike | null | undefined): boolean {
  const call = unwrap(node)
  if (call?.type === 'AwaitExpression') {
    return isCreateRequireCall(context, call.argument as NodeLike)
  }
  if (call?.type !== 'CallExpression') return false
  const callee = normalizeRequireLoader(call.callee as NodeLike)
  if (callee?.type === 'Identifier') {
    if (
      hasImport(
        context,
        callee,
        NODE_MODULE_SPECIFIERS,
        new Set(['ImportSpecifier']),
        'createRequire',
      )
    )
      return true
    return isQualifiedCreateRequireAlias(context, callee, isValueImportEquals, (namespace) =>
      isNamespaceImport(context, namespace, NODE_MODULE_SPECIFIERS),
    )
  }
  return (
    callee?.type === 'MemberExpression' &&
    propertyName(callee) === 'createRequire' &&
    isNamespaceImport(context, callee.object as NodeLike, NODE_MODULE_SPECIFIERS)
  )
}

function isCreateRequireBinding(
  context: RuleContextLike,
  node: NodeLike | null | undefined,
): boolean {
  const identifier = unwrap(node)
  if (identifier?.type !== 'Identifier') return false
  return isCreateRequireCall(context, requireBindingSource(context, identifier))
}

export function requiredModuleSpecifier(
  context: RuleContextLike,
  node: NodeLike | null | undefined,
): string | null {
  const call = unwrap(node)
  if (call?.type !== 'CallExpression') return null
  const callee = normalizeRequireLoader(call.callee as NodeLike)
  const argument = unwrap((call.arguments as NodeLike[] | undefined)?.[0])
  const moduleName =
    argument?.type === 'Literal' && typeof argument.value !== 'string'
      ? null
      : staticPropertyName(argument)
  if (typeof moduleName !== 'string') return null
  if (isCreateRequireCall(context, callee) || isCreateRequireBinding(context, callee)) {
    return moduleName
  }
  return null
}
