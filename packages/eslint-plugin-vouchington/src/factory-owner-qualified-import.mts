import { findVariable, type NodeLike, type RuleContextLike } from './ast-helpers.mts'
import { isValueImportEquals } from './factory-owner-require.mts'

export function qualifiedImportNamespaceSource(
  context: RuleContextLike,
  identifier: NodeLike,
): NodeLike | null {
  const declaration = findVariable(context, identifier)?.defs.find(
    (definition) =>
      definition.node.type === 'TSImportEqualsDeclaration' && isValueImportEquals(definition.node),
  )?.node
  const reference = declaration?.moduleReference as NodeLike | undefined
  return reference?.type === 'TSQualifiedName' && (reference.right as NodeLike).name === 'default'
    ? (reference.left as NodeLike)
    : null
}

export function isQualifiedImportFactory(
  context: RuleContextLike,
  identifier: NodeLike,
  factories: ReadonlySet<string>,
  isNamespace: (value: NodeLike) => boolean,
): boolean {
  const variable = findVariable(context, identifier)
  const qualified = variable?.defs.find(
    (definition) => definition.node.type === 'TSImportEqualsDeclaration',
  )?.node.moduleReference as NodeLike | undefined
  return (
    qualified?.type === 'TSQualifiedName' &&
    factories.has(String((qualified.right as NodeLike).name)) &&
    isNamespace(qualified.left as NodeLike)
  )
}
