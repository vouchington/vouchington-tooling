import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

export function registeredHandler(call: ts.CallExpression): boolean {
  const method = unwrapExpression(call.expression)
  return (
    ts.isPropertyAccessExpression(method) &&
    ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.name.text) &&
    ts.isCallExpression(method.expression) &&
    ts.isPropertyAccessExpression(method.expression.expression) &&
    method.expression.expression.name.text === 'route'
  )
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
