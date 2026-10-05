import { findVariable, type NodeLike, type RuleContextLike } from './ast-helpers.mts'

export function isQualifiedCreateRequireAlias(
  context: RuleContextLike,
  identifier: NodeLike,
  isValueImportEquals: (declaration: NodeLike) => boolean,
  isNamespace: (value: NodeLike) => boolean,
): boolean {
  const declaration = findVariable(context, identifier)?.defs.find(
    (definition) =>
      definition.node.type === 'TSImportEqualsDeclaration' && isValueImportEquals(definition.node),
  )?.node
  const reference = declaration?.moduleReference as NodeLike | undefined
  return Boolean(
    reference?.type === 'TSQualifiedName' && (reference.right as NodeLike).name === 'createRequire'
      ? isNamespace(reference.left as NodeLike)
      : false,
  )
}
