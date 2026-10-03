import ts from '../contract-schema/typescript-api.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'

export function unsupportedContextAlias(
  node: ts.VariableDeclaration,
  context: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  if (!node.initializer) return false
  const receiver = expressionReceiver(node.initializer, checker)
  return (
    receiver?.root === context &&
    (receiver.path.length === 0 ||
      (receiver.path.length === 1 && receiver.path[0] === 'response')) &&
    (!ts.isIdentifier(node.name) ||
      !ts.isVariableDeclarationList(node.parent) ||
      !(node.parent.flags & ts.NodeFlags.Const))
  )
}
