import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import type {
  CallbackBindings,
  createProtocolCallbackValueResolver,
} from './protocol-callback-values.mts'

export function callbackBindingReplaced(
  node: ts.Node,
  env: CallbackBindings,
  fn: ts.FunctionLikeDeclaration,
  resolver: ReturnType<typeof createProtocolCallbackValueResolver>,
): boolean {
  const { resolve, symbol } = resolver
  const write = ts.isDeleteExpression(node)
    ? node.expression
    : ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      ? node.left
      : undefined
  if (!write) return false
  let root = unwrapExpression(write)
  while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root))
    root = unwrapExpression(root.expression)
  return (ts.isIdentifier(root) && env.has(symbol(root)!)) || resolve(write, env)?.node === fn
}

/** An opaque callee may replace a callback stored in a forwarded options object. */
export function callbackOptionsEscape(
  node: ts.CallExpression | ts.NewExpression,
  env: CallbackBindings,
  fn: ts.FunctionLikeDeclaration,
  resolver: ReturnType<typeof createProtocolCallbackValueResolver>,
): boolean {
  function contains(
    value: ts.Node,
    bindings: CallbackBindings,
    seen = new Set<ts.Node>(),
  ): boolean {
    const resolved = resolver.resolve(value, bindings)
    if (!resolved || seen.has(resolved.node)) return false
    seen.add(resolved.node)
    if (resolved.node === fn) return true
    if (!ts.isObjectLiteralExpression(resolved.node)) return false
    return resolved.node.properties.some(
      (member) =>
        member === fn ||
        (ts.isPropertyAssignment(member)
          ? contains(member.initializer, resolved.env, seen)
          : ts.isShorthandPropertyAssignment(member) &&
            (() => {
              const target = resolver.property(resolved, member.name.text, new Set())
              return !!target && contains(target.node, target.env, seen)
            })()),
    )
  }
  return !!node.arguments?.some((argument) => contains(argument, env))
}
