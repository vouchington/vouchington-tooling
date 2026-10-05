import ts from '../contract-schema/typescript-api.mts'
import { expressionReceiver, type WriteReceiver } from './protocol-write-receiver.mts'

/** A void callback can still export its captured owner through an argument or side effect. */
export function callbackCapturesSelectedReceiver(
  callback: ts.FunctionLikeDeclaration,
  selected: WriteReceiver,
  checker: ts.TypeChecker,
): boolean {
  const captures = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && expressionReceiver(node, checker)?.root === selected.root)
      return true
    if (ts.isShorthandPropertyAssignment(node)) {
      const symbol = checker.getShorthandAssignmentValueSymbol(node)
      const declaration = symbol?.valueDeclaration
      if (
        declaration &&
        (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) &&
        ts.isIdentifier(declaration.name) &&
        expressionReceiver(declaration.name, checker)?.root === selected.root
      )
        return true
    }
    return node.forEachChild(captures) === true
  }
  return callback.body !== undefined && captures(callback.body)
}
