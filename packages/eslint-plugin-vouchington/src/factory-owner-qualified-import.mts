import { findVariable, type NodeLike, type RuleContextLike } from './ast-helpers.mts'
import { isValueImportEquals } from './factory-owner-require.mts'

function qualifiedNamespaceSource(value: NodeLike): NodeLike | null {
  if (value.type === 'Identifier') return value
  if (value.type !== 'TSQualifiedName' || (value.right as NodeLike).name !== 'default') return null
  return qualifiedNamespaceSource(value.left as NodeLike)
}

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
    ? qualifiedNamespaceSource(reference.left as NodeLike)
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
  const namespaceSource =
    qualified?.type === 'TSQualifiedName'
      ? qualifiedNamespaceSource(qualified.left as NodeLike)
      : null
  return (
    qualified?.type === 'TSQualifiedName' &&
    factories.has(String((qualified.right as NodeLike).name)) &&
    namespaceSource !== null &&
    isNamespace(namespaceSource)
  )
}
