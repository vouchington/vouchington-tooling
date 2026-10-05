import ts from '../contract-schema/typescript-api.mts'
import {
  httpHandlerContext,
  httpContextArgument,
  wrappedHttpContextArgument,
} from './protocol-http-context.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
import { createHttpContextValueResolver } from './protocol-http-context-values.mts'
import type { CallbackBindings } from './protocol-callback-values.mts'
import { receiverUsesThis } from './protocol-http-context-receiver.mts'
import {
  unsupportedBoundContextNode,
  boundHttpContexts,
  uncollectedContextMethod,
} from './protocol-http-context-bound-nodes.mts'
import { createContextAccountedEmissionProof } from './protocol-http-context-accounted-emissions.mts'
import { contextCallbackExecutionRoots } from './protocol-http-context-parameter-initializers.mts'
import { createContextForwardedArguments } from './protocol-http-context-forwarded-target.mts'
import { implementedHttpContextCallee as implementedCallee } from './protocol-http-context-implemented-callee.mts'
import {
  opaqueWrappedHttpContextTag,
  opaqueWrappedHttpContextArgument,
} from './protocol-http-context-callable-captures.mts'

/** Opaque consumers of the canonical context may emit undocumented status or bodies. */
export function opaqueHttpContextArgument(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  context?: ts.Symbol,
  active = new Set<ts.FunctionLikeDeclaration>(),
  env: CallbackBindings = new Map(),
  boundHandler?: ts.FunctionLikeDeclaration,
  proof = createHttpContextValueResolver(checker),
  root = call,
): boolean {
  const arguments_ = createContextForwardedArguments(checker)(call)
  const invoked = unwrapExpression(call.expression)
  const receiver =
    ts.isPropertyAccessExpression(invoked) || ts.isElementAccessExpression(invoked)
      ? invoked.expression
      : undefined
  const matches = (symbol: ts.Symbol) =>
    arguments_.some((argument) => httpContextArgument(argument, symbol, checker)) ||
    (!!receiver && wrappedHttpContextArgument(receiver, symbol, checker))
  if (
    !(
      executableProtocolPath(call, checker, boundHandler) ||
      opaqueProtocolCallbackPath(call, checker)
    )
  )
    return false
  if (context) {
    const safeCapture = (fn: ts.FunctionLikeDeclaration) =>
      !calleeEscapes(fn, call, context, checker, active, env, env, proof, root)
    if (opaqueWrappedHttpContextArgument(call, context, checker, proof.callbacks, env, safeCapture))
      return true
  }
  if (context && !matches(context)) return false
  if (context)
    return !implementedCallee(call, context, checker, active, env, proof, root, calleeEscapes)
  for (let owner = enclosingFunction(call); owner; owner = enclosingFunction(owner)) {
    const name = runtimeParameters(owner)[0]?.name
    const symbol = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
    if (symbol && matches(symbol) && httpHandlerContext(owner, checker) === symbol)
      return !implementedCallee(call, symbol, checker, active, env, proof, root, calleeEscapes)
  }
  return false
}

/** The current proven call binds canonical arguments; other foreign callers do not hide escapes. */
function calleeEscapes(
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  active: Set<ts.FunctionLikeDeclaration>,
  callerEnv: CallbackBindings,
  captured: CallbackBindings,
  values: ReturnType<typeof createHttpContextValueResolver>,
  root: ts.CallExpression,
): boolean {
  if (active.has(fn)) return true
  const receiver =
    ts.isPropertyAccessExpression(call.expression) || ts.isElementAccessExpression(call.expression)
  if (receiver && !ts.isArrowFunction(fn) && receiverUsesThis(fn.body!)) return true
  const env = callbackArgumentBindings(fn, call, callerEnv, captured, checker, values.callbacks)
  if (!env) return true
  const next = new Set(active).add(fn)
  const contexts = boundHttpContexts(fn, call, context, checker)
  if (!contexts) return true
  let escaped = false
  const accounted = createContextAccountedEmissionProof(fn, checker)
  const direct = values.callbacks.resolve(call.expression, new Map())?.node === fn
  const visitBound = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      const condition = values.resolve(node.expression, env)
      if (
        condition?.length &&
        condition.every((value) => value === null || value.node.kind === ts.SyntaxKind.FalseKeyword)
      ) {
        visitBound(node.expression)
        if (node.elseStatement) visitBound(node.elseStatement)
        return
      }
    }
    inspect(node)
    ts.forEachChild(node, visitBound)
  }
  const inspect = (node: ts.Node): void => {
    if (
      contexts.some((symbol) =>
        unsupportedBoundContextNode(node, symbol, checker, fn, (tag) =>
          opaqueWrappedHttpContextTag(
            tag,
            symbol,
            checker,
            values.callbacks,
            env,
            (nested) => !calleeEscapes(nested, call, symbol, checker, next, env, env, values, root),
          ),
        ),
      )
    )
      escaped = true
    if (
      ts.isCallExpression(node) &&
      executableProtocolPath(node, checker, fn) &&
      contexts.some(
        (symbol) =>
          uncollectedContextMethod(node, symbol, checker, fn, {
            selected: call === root,
            direct,
          }) &&
          !accounted(node, symbol) &&
          !values.accountedSse(node, symbol, call, root),
      )
    )
      escaped = true
    if (
      ts.isCallExpression(node) &&
      contexts.some((symbol) =>
        opaqueHttpContextArgument(node, checker, symbol, next, env, fn, values, root),
      )
    )
      escaped = true
  }
  contextCallbackExecutionRoots(fn, call, callerEnv, checker, contexts).forEach(visitBound)
  return escaped
}
