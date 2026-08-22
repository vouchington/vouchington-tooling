import {
  findVariable,
  propertyName,
  unwrap,
  type CursorAstHelpers,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'
import {
  matchesCursorFile,
  resolveCursorContractOptions,
  type CursorModuleConfig,
} from './postgres-cursor-options.mts'
import {
  directCallParent,
  isCursorExecutor,
  isCursorModule,
  isTypeQuery,
  namedCursorImport,
  namespaceCursorImport,
  namespaceCursorMember,
  namespaceImportMember,
  queryHead,
  transparentParent,
} from './postgres-cursor-query.mts'

const helpers: CursorAstHelpers = { findVariable, propertyName, unwrap }

export function createPostgresCursorCallContractRule() {
  return {
    meta: {
      type: 'problem' as const,
      docs: { description: 'require direct cursor calls with statically annotated SQL' },
      schema: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            modules: { type: 'array', items: { type: 'string' } },
            executors: { type: 'array', items: { type: 'string' } },
            include: { type: 'array', items: { type: 'string' } },
            exclude: { type: 'array', items: { type: 'string' } },
            includeFiles: { type: 'array', items: { type: 'string' } },
            annotation: { type: 'string' },
          },
        },
      ],
      messages: {
        annotation: 'PostgreSQL cursor SQL must start with a static /* name */ annotation.',
        directUse:
          'PostgreSQL cursor helpers must be called directly so their SQL can be verified.',
        staticQuery:
          'PostgreSQL cursor SQL must be visible at the callsite or in one immutable local binding.',
        staticNamespaceMember:
          'PostgreSQL namespace members must use a static property name so cursor use can be verified.',
      },
    },
    create(context: RuleContextLike) {
      const options = resolveCursorContractOptions(context.options[0])
      if (!options || !matchesCursorFile(context, options)) return {}
      const reportedDirectUses = new WeakSet<object>()
      return {
        CallExpression(node: NodeLike) {
          const callee = helpers.unwrap(node.callee as NodeLike)
          const executor =
            namedCursorImport(context, callee, helpers, options) ||
            namespaceCursorMember(context, callee, helpers, options)
          if (!executor) return
          const argument = (node.arguments as NodeLike[] | undefined)?.[0]
          const reportNode = argument ?? node
          const head = argument ? queryHead(context, argument, helpers, options) : null
          if (head === null) {
            context.report({ messageId: 'staticQuery', node: reportNode })
            return
          }
          if (!options.annotation.test(head)) {
            context.report({ messageId: 'annotation', node: reportNode })
          }
        },
        Identifier(node: NodeLike) {
          visitCursorIdentifier(context, node, options, reportedDirectUses)
        },
        MemberExpression(node: NodeLike) {
          visitNamespaceMember(context, node, options)
        },
        ExportAllDeclaration(node: NodeLike) {
          if (reExportsCursor(node, options)) context.report({ messageId: 'directUse', node })
        },
        ExportNamedDeclaration(node: NodeLike) {
          if (reExportsCursor(node, options)) context.report({ messageId: 'directUse', node })
        },
      }
    },
  }
}

function visitCursorIdentifier(
  context: RuleContextLike,
  node: NodeLike,
  options: CursorModuleConfig,
  reportedDirectUses: WeakSet<object>,
): void {
  const namedImport = namedCursorImport(context, node, helpers, options)
  const namespaceImport = namespaceCursorImport(context, node, helpers, options)
  if (!namedImport && !namespaceImport) return
  if (
    node.parent?.type === 'ImportSpecifier' ||
    node.parent?.type === 'ImportNamespaceSpecifier' ||
    isTypeQuery(node) ||
    isTypeOnlyExport(node)
  ) {
    return
  }
  const variable = helpers.findVariable(context, node)
  if (!variable?.references.some((reference) => reference.identifier === node)) return
  const expression = transparentParent(node)
  if (namespaceImport && namespaceImportMember(context, expression.parent, helpers, options)) {
    return
  }
  if (!directCallParent(node) && !reportedDirectUses.has(node)) {
    reportedDirectUses.add(node)
    context.report({ messageId: 'directUse', node })
  }
}

function visitNamespaceMember(
  context: RuleContextLike,
  node: NodeLike,
  options: CursorModuleConfig,
): void {
  const namespaceMember = namespaceImportMember(context, node, helpers, options)
  if (!namespaceMember || isTypeQuery(node)) return
  if (namespaceMember.computed && helpers.propertyName(namespaceMember) == null) {
    context.report({ messageId: 'staticNamespaceMember', node })
    return
  }
  if (namespaceCursorMember(context, node, helpers, options) && !directCallParent(node)) {
    context.report({ messageId: 'directUse', node })
  }
}

function reExportsCursor(node: NodeLike, config: CursorModuleConfig): boolean {
  const source = node.source as { value?: unknown } | undefined
  if (!isCursorModule(source?.value, config) || node.exportKind === 'type') return false
  if (node.type === 'ExportAllDeclaration') return true
  return (
    (node.specifiers as NodeLike[] | undefined)?.some((specifier) => {
      const local = specifier.local as { name?: string; value?: unknown } | undefined
      const name = local?.name ?? local?.value
      return specifier.exportKind !== 'type' && isCursorExecutor(name, config)
    }) === true
  )
}

function isTypeOnlyExport(identifier: NodeLike): boolean {
  const specifier = identifier.parent
  return (
    specifier?.type === 'ExportSpecifier' &&
    (specifier.exportKind === 'type' || specifier.parent?.exportKind === 'type')
  )
}
