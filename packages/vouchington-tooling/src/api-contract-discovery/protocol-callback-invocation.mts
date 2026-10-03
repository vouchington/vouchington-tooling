import ts from '../contract-schema/typescript-api.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { invokedResult, registeredHandler } from './protocol-callback-registration.mts'
import { platformCallbackArgument } from './protocol-platform-callbacks.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { callbackBindingReplaced, callbackOptionsEscape } from './protocol-callback-mutations.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction as functionNode,
  protocolCallbackSourceCalls,
  protocolCallbackHasWrittenBindings,
  type CallbackBindings as Bindings,
} from './protocol-callback-values.mts'
type FunctionNode = ts.FunctionLikeDeclaration
/** Proves callback consumption through concrete helper bodies, without executing nested closures. */
export function isSupportedProtocolCallback(fn: FunctionNode, checker: ts.TypeChecker): boolean {
  if (!fn.body || fn.asteriskToken || protocolCallbackHasWrittenBindings(fn, checker)) return false
  const resolver = createProtocolCallbackValueResolver(checker)
  const { resolve, symbol } = resolver
  let invalidated = false
  function consumed(
    call: ts.CallExpression | ts.NewExpression,
    env: Bindings,
    active: Set<FunctionNode>,
    returned = false,
  ): boolean {
    const platform = platformCallbackArgument(call, checker)
    const callee = resolve(platform ?? call.expression, env)
    if (!callee || !functionNode(callee.node) || !callee.node.body || callee.node.asteriskToken) {
      invalidated ||= callbackOptionsEscape(call, env, fn, resolver)
      return false
    }
    if (protocolCallbackHasWrittenBindings(callee.node, checker)) {
      invalidated = true
      return false
    }
    if (callee.node === fn) return !returned
    if (active.has(callee.node)) return false
    const chain = new Set([...active, callee.node])
    if (platform) return body(callee.node.body, callee.env, chain, false)
    const next = new Map(callee.env)
    runtimeParameters(callee.node).forEach((parameter, index) => {
      const argument = call.arguments![index]
      const target = symbol(parameter.name)!
      if (argument && !ts.isSpreadElement(argument)) next.set(target, { node: argument, env })
    })
    return body(callee.node.body, next, chain, returned || invokedResult(call))
  }
  function body(
    content: ts.ConciseBody,
    env: Bindings,
    active: Set<FunctionNode>,
    returned: boolean,
  ): boolean {
    let found = false
    let replaced = false
    function visit(node: ts.Node) {
      if (found || replaced || !potentiallyExecuted(node)) return
      if (functionNode(node)) return
      if (callbackBindingReplaced(node, env, fn, resolver)) {
        replaced = true
        invalidated = true
        return
      }
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        consumed(node, env, active, returned && ts.isReturnStatement(node.parent)) &&
        (!returned || ts.isReturnStatement(node.parent))
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
          body(value.node.body, value.env, new Set([...active, value.node]), false)
        ) {
          found = true
          return
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(content)
    return found && !invalidated
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
  if (!ts.isCallExpression(call) && !ts.isNewExpression(call)) {
    const owner = enclosingFunction(fn)
    if (owner && isSupportedProtocolCallback(owner, checker))
      return body(owner.body!, new Map(), new Set([owner]), false)
    return protocolCallbackSourceCalls(fn).some(
      (candidate) =>
        potentiallyExecuted(candidate) &&
        ((registeredHandler(candidate) &&
          candidate.arguments.some((value) => resolve(value, new Map())?.node === fn)) ||
          consumed(candidate, new Map(), new Set())),
    )
  }
  if (!potentiallyExecuted(call)) return false
  if (ts.isCallExpression(call) && call.expression === argument) return true
  if (argument === fn && ts.isCallExpression(call) && registeredHandler(call)) return true
  return (
    !!call.arguments?.includes(argument as ts.Expression) && consumed(call, new Map(), new Set())
  )
}
