export type NodeLike = {
  type: string
  parent?: NodeLike | null
  [key: string]: unknown
}

type ScopeLike = {
  set?: { get: (name: string) => VariableLike | undefined }
  variables?: VariableLike[]
  upper: ScopeLike | null
}

export type VariableLike = {
  name: string
  defs: DefinitionLike[]
  references: ReferenceLike[]
}

type DefinitionLike = {
  type: string
  node: NodeLike
  parent?: NodeLike | null
}

type ReferenceLike = {
  identifier: NodeLike
  isWrite: () => boolean
}

export type RuleContextLike = {
  filename: string
  cwd?: string
  options: unknown[]
  report: (descriptor: { messageId: string; node: NodeLike }) => void
  sourceCode: { getScope: (node: NodeLike) => ScopeLike }
}

export type CursorAstHelpers = {
  findVariable: typeof findVariable
  propertyName: typeof propertyName
  unwrap: typeof unwrap
}

const WRAPPERS = new Set([
  'ChainExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
])

export function unwrap(node: NodeLike | null | undefined): NodeLike | null | undefined {
  let current = node
  while (current && WRAPPERS.has(current.type)) {
    current = current.expression as NodeLike | undefined
  }
  return current
}

export function findVariable(context: RuleContextLike, identifier: NodeLike): VariableLike | null {
  if (typeof identifier.name !== 'string') return null
  let scope: ScopeLike | null = context.sourceCode.getScope(identifier)
  while (scope) {
    const variable =
      (typeof scope.set?.get === 'function' && scope.set.get(identifier.name)) ||
      scope.variables?.find((candidate) => candidate.name === identifier.name)
    if (variable) return variable
    scope = scope.upper
  }
  return null
}

export function propertyName(
  member: NodeLike | null | undefined,
): string | number | boolean | bigint | null {
  if (member?.type !== 'MemberExpression') return null
  const property = member.property as NodeLike | undefined
  if (!member.computed && property?.type === 'Identifier' && typeof property.name === 'string') {
    return property.name
  }
  return member.computed ? staticPropertyName(property) : null
}

export function patternPropertyName(
  property: NodeLike | null | undefined,
): string | number | boolean | bigint | null {
  if (!property) return null
  if (!property.computed && (property.key as NodeLike | undefined)?.type === 'Identifier') {
    const name = (property.key as NodeLike).name
    return typeof name === 'string' ? name : null
  }
  return staticPropertyName(property.key as NodeLike | undefined)
}

export function memberIsRead(node: NodeLike): boolean {
  const parent = node.parent
  if (parent?.type === 'AssignmentExpression' && parent.left === node) {
    return parent.operator !== '='
  }
  return !(parent?.type === 'UnaryExpression' && parent.operator === 'delete')
}

export function normalizeFilename(context: { filename: string; cwd?: string }): string {
  const filename = context.filename.replaceAll('\\', '/')
  const cwd = context.cwd?.replaceAll('\\', '/').replace(/\/$/, '')
  return cwd && filename.startsWith(`${cwd}/`) ? filename.slice(cwd.length + 1) : filename
}

function staticPropertyName(node: NodeLike | undefined): string | number | boolean | bigint | null {
  const value = unwrap(node)
  if (value?.type === 'Literal') return literalName(value.value)
  if (
    value?.type === 'TemplateLiteral' &&
    (value.expressions as unknown[] | undefined)?.length === 0
  ) {
    const quasi = (
      value.quasis as Array<{ value?: { cooked?: string | null; raw?: string } }> | undefined
    )?.[0]
    return quasi?.value?.cooked ?? quasi?.value?.raw ?? null
  }
  return null
}

function literalName(value: unknown): string | number | boolean | bigint | null {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value
  }
  return null
}
