import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'

/** A retained concrete container exposes selected values stored by its reached owner. */
export function storedSseContainerCapability(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  selected: (value: ts.Expression) => boolean,
): boolean {
  const container = expressionReceiver(expression, checker)
  const owner = enclosingFunction(expression)
  const declaration = container?.root.valueDeclaration
  const initializer =
    declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
      ? unwrapExpression(declaration.initializer)
      : undefined
  if (
    !container ||
    !initializer ||
    !(ts.isObjectLiteralExpression(initializer) || ts.isArrayLiteralExpression(initializer)) ||
    !owner ||
    !('body' in owner) ||
    !owner.body
  )
    return false
  function stored(node: ts.Node): boolean {
    if (!executableProtocolPath(node, checker, owner)) return false
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = unwrapExpression(node.left)
      const receiver =
        (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) &&
        expressionReceiver(target.expression, checker)
      if (
        receiver &&
        receiver.root === container!.root &&
        receiver.path.length >= container!.path.length &&
        container!.path.every((part, index) => receiver.path[index] === part) &&
        selected(node.right)
      )
        return true
    }
    return node.forEachChild(stored) === true
  }
  return stored(owner.body)
}
