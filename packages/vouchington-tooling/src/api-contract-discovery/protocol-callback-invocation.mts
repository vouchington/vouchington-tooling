import ts from '../contract-schema/typescript-api.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction as functionNode,
  protocolCallbackSourceCalls,
  protocolCallbackHasWrittenBindings,
  type CallbackBindings as Bindings,
} from './protocol-callback-values.mts'
type FunctionNode = ts.FunctionLikeDeclaration
function registeredHandler(call: ts.CallExpression): boolean {
  const method = unwrapExpression(call.expression)
  return (
    ts.isPropertyAccessExpression(method) &&
    ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.name.text) &&
    ts.isCallExpression(method.expression) &&
    ts.isPropertyAccessExpression(method.expression.expression) &&
    method.expression.expression.name.text === 'route'
  )
}
function invokedResult(call: ts.CallExpression): boolean {
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
/** Proves callback consumption through concrete helper bodies, without executing nested closures. */
export function isSupportedProtocolCallback(fn: FunctionNode, checker: ts.TypeChecker): boolean {
  if (!fn.body || fn.asteriskToken || protocolCallbackHasWrittenBindings(fn, checker)) return false
  const { resolve, symbol } = createProtocolCallbackValueResolver(checker)
  function consumed(
    call: ts.CallExpression,
    env: Bindings,
    active: Set<FunctionNode>,
    returned = false,
  ): boolean {
    const callee = resolve(call.expression, env)
    if (!callee || !functionNode(callee.node) || callee.node.asteriskToken) return false
    if (protocolCallbackHasWrittenBindings(callee.node, checker)) return false
    if (callee.node === fn) return true
    if (!callee.node.body || active.has(callee.node)) return false
    const next = new Map(callee.env)
    runtimeParameters(callee.node).forEach((parameter, index) => {
      const argument = call.arguments[index]
      const target = ts.isIdentifier(parameter.name) && symbol(parameter.name)
      if (target && argument && !ts.isSpreadElement(argument))
        next.set(target, { node: argument, env })
    })
    const chain = new Set([...active, callee.node])
    return body(callee.node, next, chain, returned || invokedResult(call))
  }
  function body(
    owner: FunctionNode,
    env: Bindings,
    active: Set<FunctionNode>,
    returned: boolean,
  ): boolean {
    let found = false
    let replaced = false
    function visit(node: ts.Node) {
      if (found || replaced || !potentiallyExecuted(node)) return
      if (functionNode(node)) return
      const write = ts.isDeleteExpression(node)
        ? node.expression
        : ts.isBinaryExpression(node) &&
            node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          ? node.left
          : undefined
      if (write) {
        let root = unwrapExpression(write)
        while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root))
          root = unwrapExpression(root.expression)
        if ((ts.isIdentifier(root) && env.has(symbol(root)!)) || resolve(write, env)?.node === fn) {
          replaced = true
          return
        }
      }
      if (
        ts.isCallExpression(node) &&
        consumed(node, env, active, returned && ts.isReturnStatement(node.parent))
      ) {
        found = true
        return
      }
      if (returned && ts.isReturnStatement(node) && node.expression) {
        const value = resolve(node.expression, env)
        if (
          value &&
          functionNode(value.node) &&
          value.node.body &&
          !value.node.asteriskToken &&
          !active.has(value.node) &&
          body(value.node, value.env, new Set([...active, value.node]), false)
        ) {
          found = true
          return
        }
      }
      ts.forEachChild(node, visit)
    }
    if (owner.body) visit(owner.body)
    return found
  }
  let argument: ts.Node = fn
  while (
    ts.isPropertyAssignment(argument.parent) ||
    ts.isObjectLiteralExpression(argument.parent) ||
    ts.isParenthesizedExpression(argument.parent) ||
    ts.isAsExpression(argument.parent) ||
    ts.isNonNullExpression(argument.parent)
  )
    argument = argument.parent
  const call = argument.parent
  if (!ts.isCallExpression(call))
    return protocolCallbackSourceCalls(fn).some(
      (candidate) =>
        potentiallyExecuted(candidate) &&
        ((registeredHandler(candidate) &&
          candidate.arguments.some((value) => resolve(value, new Map())?.node === fn)) ||
          consumed(candidate, new Map(), new Set())),
    )
  if (!potentiallyExecuted(call)) return false
  if (call.expression === argument) return true
  if (argument === fn && registeredHandler(call)) return true
  return call.arguments.includes(argument as ts.Expression) && consumed(call, new Map(), new Set())
}
