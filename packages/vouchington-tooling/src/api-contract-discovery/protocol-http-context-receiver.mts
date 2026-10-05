import ts from '../contract-schema/typescript-api.mts'
import { isProtocolCallbackFunction, type CallbackBindings } from './protocol-callback-values.mts'
import { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import type { ContextValues } from './protocol-http-context-value-types.mts'

export function receiverUsesThis(node: ts.Node): boolean {
  let found = false
  function visit(value: ts.Node) {
    if (value.kind === ts.SyntaxKind.ThisKeyword) found = true
    ts.forEachChild(value, visit)
  }
  visit(node)
  return found
}

/** Only the receiver owner currently being proved may defer its recursive obligation. */
export function createContextReceiverGuard(
  checker: ts.TypeChecker,
  resolve: (node: ts.Node, env: CallbackBindings) => ContextValues,
) {
  const { root } = createContextValueRoots(checker)
  const active: (readonly [ts.Symbol, CallbackBindings])[][] = []
  function checking(symbol: ts.Symbol, env: CallbackBindings): boolean {
    return active.some((frame) =>
      frame.some(([target, bindings]) => target === symbol && bindings === env),
    )
  }
  function safe(call: ts.CallExpression, env: CallbackBindings): boolean {
    const expression = call.expression
    if (!(ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)))
      return false
    const owners: [ts.Symbol, CallbackBindings][] = []
    function owner(node: ts.Node, bindings: CallbackBindings) {
      const symbol = ts.isExpression(node) ? root(node) : undefined
      if (!symbol || owners.some(([target, scope]) => target === symbol && scope === bindings))
        return
      owners.push([symbol, bindings])
      const bound = bindings.get(symbol)
      if (bound) owner(bound.node, bound.env)
    }
    owner(expression.expression, env)
    active.push(owners)
    try {
      const values = resolve(expression, env)
      return (
        !!values?.length &&
        values.every(
          (value) =>
            value === null ||
            ts.isStringLiteral(value.node) ||
            ts.isNumericLiteral(value.node) ||
            value.node.kind === ts.SyntaxKind.TrueKeyword ||
            value.node.kind === ts.SyntaxKind.FalseKeyword ||
            (isProtocolCallbackFunction(value.node) &&
              !!value.node.body &&
              (ts.isArrowFunction(value.node) || !receiverUsesThis(value.node.body))),
        )
      )
    } finally {
      active.pop()
    }
  }
  return { checking, safe }
}
