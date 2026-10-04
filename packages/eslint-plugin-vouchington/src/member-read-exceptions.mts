import { canonicalConstructor, constantArgument } from './member-read-exception-bindings.mts'
import {
  findVariable,
  normalizeFilename,
  patternPropertyName,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'
import { type MemberReadException } from './member-read-exception-options.mts'

function effectivePrefix(object: NodeLike | null | undefined, prefix: string): boolean {
  if (object?.type !== 'ObjectExpression') return false
  let matches = false
  for (const property of object.properties as NodeLike[]) {
    if (property.type === 'SpreadElement') {
      matches = false
      continue
    }
    const name = patternPropertyName(property)
    if (name === 'prefix') {
      const value = property.value as NodeLike | undefined
      matches = value?.type === 'Literal' && value.value === prefix
    } else if (name === null && property.computed) {
      matches = false
    }
  }
  return matches
}

function position(node: NodeLike, end: boolean): number {
  const range = node.range as number[] | undefined
  return range?.[end ? 1 : 0] ?? Number(node[end ? 'end' : 'start'])
}

function constantInstance(
  context: RuleContextLike,
  identifier: NodeLike | null | undefined,
  exception: MemberReadException & { kind: 'const-instance-prefix' },
): boolean {
  if (identifier?.type !== 'Identifier') return false
  const variable = findVariable(context, identifier)
  return Boolean(
    variable?.defs.some((definition) => {
      const declaration = definition.node
      const id = declaration.id as NodeLike | undefined
      const initializer = unwrap(declaration.init as NodeLike | undefined)
      const callee = unwrap(initializer?.callee as NodeLike | undefined)
      const args = initializer?.arguments as NodeLike[] | undefined
      return (
        definition.type === 'Variable' &&
        declaration.type === 'VariableDeclarator' &&
        id?.type === 'Identifier' &&
        declaration.parent?.kind === 'const' &&
        initializer?.type === 'NewExpression' &&
        canonicalConstructor(context, callee ?? undefined, exception) &&
        effectivePrefix(unwrap(args?.[0]), exception.prefix) &&
        !variable.references.some(
          (reference) =>
            reference.identifier !== declaration.id &&
            reference.isWrite() &&
            position(reference.identifier, false) > position(declaration, true),
        )
      )
    }),
  )
}

export function isMemberReadException(
  context: RuleContextLike,
  member: NodeLike,
  exceptions: readonly MemberReadException[],
): boolean {
  const call = member.parent
  if (call?.type !== 'CallExpression' || call.callee !== member) return false
  const object = unwrap(member.object as NodeLike | undefined)
  const args = call.arguments as NodeLike[]
  return exceptions.some((exception) => {
    if (normalizeFilename(context) !== exception.file || propertyName(member) !== exception.member)
      return false
    if (exception.kind === 'constructor-constant') {
      return (
        args.length === 1 &&
        canonicalConstructor(context, object ?? undefined, exception) &&
        constantArgument(context, args[0], exception.constant)
      )
    }
    return (
      !call.optional &&
      !member.optional &&
      args.length === 0 &&
      constantInstance(context, object, exception)
    )
  })
}
