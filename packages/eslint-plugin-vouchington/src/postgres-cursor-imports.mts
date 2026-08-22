import {
  type CursorAstHelpers,
  type NodeLike,
  type RuleContextLike,
  type VariableLike,
} from './ast-helpers.mts'
import type { CursorModuleConfig } from './postgres-cursor-options.mts'

export function isCursorModule(name: unknown, config: CursorModuleConfig): boolean {
  return typeof name === 'string' && config.modules.has(name)
}

export function isCursorExecutor(name: unknown, config: CursorModuleConfig): boolean {
  return typeof name === 'string' && config.executors.has(name)
}

export function namedCursorImport(
  context: RuleContextLike,
  identifier: NodeLike | null | undefined,
  helpers: CursorAstHelpers,
  config: CursorModuleConfig,
): string | null {
  if (identifier?.type !== 'Identifier') return null
  const imported = importDefinition(
    helpers.findVariable(context, identifier),
    'ImportSpecifier',
    config,
  )?.node.imported as { name?: string; value?: unknown } | undefined
  const name = imported?.name ?? imported?.value
  return isCursorExecutor(name, config) ? String(name) : null
}

export function namespaceCursorImport(
  context: RuleContextLike,
  identifier: NodeLike | null | undefined,
  helpers: CursorAstHelpers,
  config: CursorModuleConfig,
): boolean {
  return (
    identifier?.type === 'Identifier' &&
    Boolean(
      importDefinition(
        helpers.findVariable(context, identifier),
        'ImportNamespaceSpecifier',
        config,
      ),
    )
  )
}

export function namespaceImportMember(
  context: RuleContextLike,
  node: NodeLike | null | undefined,
  helpers: CursorAstHelpers,
  config: CursorModuleConfig,
): NodeLike | null {
  const member = helpers.unwrap(node)
  if (member?.type !== 'MemberExpression') return null
  const object = helpers.unwrap(member.object as NodeLike)
  if (object?.type !== 'Identifier') return null
  return namespaceCursorImport(context, object, helpers, config) ? member : null
}

export function namespaceCursorMember(
  context: RuleContextLike,
  node: NodeLike | null | undefined,
  helpers: CursorAstHelpers,
  config: CursorModuleConfig,
): string | null {
  const member = namespaceImportMember(context, node, helpers, config)
  const name = member && helpers.propertyName(member)
  return isCursorExecutor(name, config) ? String(name) : null
}

function importDefinition(
  variable: VariableLike | null,
  specifierType: string,
  config: CursorModuleConfig,
) {
  return variable?.defs.find((definition) => {
    const specifier = definition.node
    const declaration = definition.parent || specifier.parent
    return (
      definition.type === 'ImportBinding' &&
      specifier.type === specifierType &&
      specifier.importKind !== 'type' &&
      declaration?.type === 'ImportDeclaration' &&
      declaration.importKind !== 'type' &&
      isCursorModule((declaration.source as { value?: unknown } | undefined)?.value, config)
    )
  })
}
