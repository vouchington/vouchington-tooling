import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

export function registeredHandler(call: ts.CallExpression): boolean {
  const method = unwrapExpression(call.expression)
  if (
    !ts.isPropertyAccessExpression(method) ||
    !['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.name.text)
  )
    return false
  let receiver: ts.Expression = method.expression
  while (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
    if (receiver.expression.name.text === 'route') return true
    receiver = receiver.expression.expression
  }
  return false
}
export function invokedResult(call: ts.CallExpression | ts.NewExpression): boolean {
  let node: ts.Node = call
  while (
    ts.isParenthesizedExpression(node.parent) ||
    ts.isAsExpression(node.parent) ||
    ts.isNonNullExpression(node.parent) ||
    ts.isAwaitExpression(node.parent)
  )
    node = node.parent
  const parent = node.parent
  return (
    ts.isCallExpression(parent) &&
    (parent.expression === node ||
      (registeredHandler(parent) && parent.arguments.includes(node as ts.Expression)))
  )
}
