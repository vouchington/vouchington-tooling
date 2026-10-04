import { findVariable, type NodeLike, type RuleContextLike } from './ast-helpers.mts'

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
