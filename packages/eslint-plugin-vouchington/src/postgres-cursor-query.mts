import { type CursorAstHelpers, type NodeLike, type RuleContextLike } from './ast-helpers.mts'
import { isDiscardedSqlStatementAppend } from './postgres-cursor-append.mts'
import { namedCursorImport, namespaceCursorMember } from './postgres-cursor-imports.mts'
import type { CursorModuleConfig } from './postgres-cursor-options.mts'

export {
  isCursorExecutor,
  isCursorModule,
  namedCursorImport,
  namespaceCursorImport,
  namespaceCursorMember,
  namespaceImportMember,
} from './postgres-cursor-imports.mts'

export function transparentParent(node: NodeLike): NodeLike {
  let current = node
  while (
    current.parent &&
    (current.parent.type === 'ChainExpression' ||
      current.parent.type === 'TSAsExpression' ||
      current.parent.type === 'TSSatisfiesExpression' ||
      current.parent.type === 'TSTypeAssertion' ||
      current.parent.type === 'TSNonNullExpression') &&
    current.parent.expression === current
  ) {
    current = current.parent
  }
  return current
}

export function directCallParent(node: NodeLike): NodeLike | null {
  const current = transparentParent(node)
  return current.parent?.type === 'CallExpression' && current.parent.callee === current
    ? current.parent
    : null
}

export function isTypeQuery(node: NodeLike): boolean {
  let current = transparentParent(node)
  while (current.parent?.type === 'TSQualifiedName') current = current.parent
  return current.parent?.type === 'TSTypeQuery'
}

export function queryHead(
  context: RuleContextLike,
  node: NodeLike,
  helpers: CursorAstHelpers,
  config: CursorModuleConfig,
): string | null {
  const direct = directQueryHead(context, node, helpers)
  if (direct !== null) return direct
  const value = helpers.unwrap(node)
  if (value?.type !== 'Identifier') return null
  const variable = helpers.findVariable(context, value)
  const definitions = variable?.defs.filter((definition) => definition.type === 'Variable') ?? []
  if (definitions.length !== 1) return null
  const declaration = definitions[0]?.node
  if (
    declaration?.type !== 'VariableDeclarator' ||
    declaration.parent?.type !== 'VariableDeclaration' ||
    declaration.parent.kind !== 'const' ||
    variable?.references.some((reference) => {
      const identifier = reference.identifier
      return (
        identifier !== declaration.id &&
        !isTypeQuery(identifier) &&
        !isCursorQueryArgument(context, identifier, helpers, config) &&
        !isDiscardedSqlStatementAppend(identifier, helpers, transparentParent)
      )
    })
  ) {
    return null
  }
  return directQueryHead(context, declaration.init as NodeLike, helpers)
}

function exactSqlTag(context: RuleContextLike, tag: NodeLike, helpers: CursorAstHelpers): boolean {
  const identifier = helpers.unwrap(tag)
  if (identifier?.type !== 'Identifier') return false
  const variable = helpers.findVariable(context, identifier)
  const definition = variable?.defs.find((candidate) => {
    const specifier = candidate.node
    const declaration = candidate.parent || specifier.parent
    return (
      candidate.type === 'ImportBinding' &&
      specifier.type === 'ImportDefaultSpecifier' &&
      specifier.importKind !== 'type' &&
      declaration?.type === 'ImportDeclaration' &&
      declaration.importKind !== 'type' &&
      (declaration.source as { value?: unknown } | undefined)?.value === 'sql-template-strings'
    )
  })
  return Boolean(
    definition && variable && !variable.references.some((reference) => reference.isWrite()),
  )
}

export function firstQuasiText(template: NodeLike | undefined, allowRaw: boolean): string | null {
  const quasi = (
    template?.quasis as Array<{ value?: { cooked?: string | null; raw?: string } }> | undefined
  )?.[0]
  if (!quasi) return null
  return quasi.value?.cooked ?? (allowRaw ? (quasi.value?.raw ?? null) : null)
}

function directQueryHead(
  context: RuleContextLike,
  node: NodeLike | null | undefined,
  helpers: CursorAstHelpers,
): string | null {
  const value = helpers.unwrap(node)
  if (value?.type === 'Literal') return typeof value.value === 'string' ? value.value : null
  if (value?.type === 'TemplateLiteral') return firstQuasiText(value, true)
  if (
    value?.type === 'TaggedTemplateExpression' &&
    exactSqlTag(context, value.tag as NodeLike, helpers)
  ) {
    return firstQuasiText(value.quasi as NodeLike, false)
  }
  return null
}

function isCursorQueryArgument(
  context: RuleContextLike,
  identifier: NodeLike,
  helpers: CursorAstHelpers,
  config: CursorModuleConfig,
): boolean {
  const argument = transparentParent(identifier)
  const call = argument.parent
  if (
    call?.type !== 'CallExpression' ||
    (call.arguments as NodeLike[] | undefined)?.[0] !== argument
  ) {
    return false
  }
  const callee = helpers.unwrap(call.callee as NodeLike)
  return Boolean(
    namedCursorImport(context, callee, helpers, config) ||
    namespaceCursorMember(context, callee, helpers, config),
  )
}
