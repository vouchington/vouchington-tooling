import { findVariable, unwrap, type NodeLike, type RuleContextLike } from './ast-helpers.mts'
import { type MemberReadException } from './member-read-exception-options.mts'

export function canonicalConstructor(
  context: RuleContextLike,
  identifier: NodeLike | undefined,
  exception: MemberReadException,
): boolean {
  if (identifier?.type !== 'Identifier' || identifier.name !== exception.local) return false
  return Boolean(
    findVariable(context, identifier)?.defs.some((definition) => {
      const specifier = definition.node
      const declaration = definition.parent ?? specifier.parent
      const imported = specifier.imported as NodeLike | undefined
      const source = declaration?.source as NodeLike | undefined
      return (
        definition.type === 'ImportBinding' &&
        specifier.type === 'ImportSpecifier' &&
        specifier.importKind !== 'type' &&
        (imported?.name ?? imported?.value) === exception.imported &&
        declaration?.type === 'ImportDeclaration' &&
        declaration.importKind !== 'type' &&
        source?.value === exception.module
      )
    }),
  )
}

export function constantArgument(
  context: RuleContextLike,
  argument: NodeLike | undefined,
  expected: { name: string; value: string },
): boolean {
  if (argument?.type !== 'Identifier' || argument.name !== expected.name) return false
  return Boolean(
    findVariable(context, argument)?.defs.some((definition) => {
      const declaration = definition.node
      const id = declaration.id as NodeLike | undefined
      const initializer = unwrap(declaration.init as NodeLike | undefined)
      return (
        definition.type === 'Variable' &&
        declaration.type === 'VariableDeclarator' &&
        id?.type === 'Identifier' &&
        id.name === expected.name &&
        declaration.parent?.kind === 'const' &&
        initializer?.type === 'Literal' &&
        initializer.value === expected.value
      )
    }),
  )
}
