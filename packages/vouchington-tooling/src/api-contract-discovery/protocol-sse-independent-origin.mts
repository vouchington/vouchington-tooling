import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
import { platformCallbackArgument } from './protocol-platform-callbacks.mts'
import { symbolBindingWritten } from './protocol-sse-binding-writes.mts'
import { callbackCapturesSelectedReceiver } from './protocol-sse-callback-capture.mts'
import type { WriteReceiver } from './protocol-write-receiver.mts'

/** Recognize only values with a separately allocated origin needed by SSE control calls. */
export function independentArgumentOrigin(
  actual: WriteReceiver,
  checker: ts.TypeChecker,
  selected?: WriteReceiver,
): boolean {
  if (actual.path.length !== 0) return false
  const declaration = actual.root.valueDeclaration
  if (declaration && ts.isFunctionDeclaration(declaration) && declaration.body)
    return (
      !declaration.asteriskToken &&
      !symbolBindingWritten(declaration.getSourceFile(), actual.root, checker, true) &&
      returnedExpressions(declaration).every((value) => value === undefined) &&
      (!selected || !callbackCapturesSelectedReceiver(declaration, selected, checker))
    )
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const) ||
    !declaration.initializer ||
    symbolBindingWritten(declaration.getSourceFile(), actual.root, checker, true)
  )
    return false
  const initializer = unwrapExpression(declaration.initializer)
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    return (
      !(ts.isFunctionExpression(initializer) && initializer.asteriskToken) &&
      returnedExpressions(initializer).every((value) => value === undefined) &&
      (!selected || !callbackCapturesSelectedReceiver(initializer, selected, checker))
    )
  if (ts.isStringLiteral(initializer) || ts.isNumericLiteral(initializer)) return true
  if (!ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression)) return false
  if (initializer.expression.text !== 'setInterval') return false
  const symbol = checker.getSymbolAtLocation(initializer.expression)
  return (
    symbol !== undefined &&
    !symbolBindingWritten(initializer.getSourceFile(), symbol, checker, true) &&
    platformCallbackArgument(initializer, checker) !== undefined
  )
}
