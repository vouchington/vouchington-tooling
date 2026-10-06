import ts from '../contract-schema/typescript-api.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
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
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueWrappedHttpContextTag } from './protocol-http-context-callable-captures.mts'
import type { opaqueHttpContextArgument } from './protocol-http-context-escapes.mts'
export function createHttpContextCalleeEscapeProof(opaque: typeof opaqueHttpContextArgument) {
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
    rootContext = context,
  ): boolean {
    if (active.has(fn)) return true
    const receiver =
      ts.isPropertyAccessExpression(call.expression) ||
      ts.isElementAccessExpression(call.expression)
    const extension = values.extension(call, context, root, rootContext)
    if (receiver && !ts.isArrowFunction(fn) && receiverUsesThis(fn.body!) && extension?.node !== fn)
      return true
    const env = callbackArgumentBindings(fn, call, callerEnv, captured, checker, values.callbacks)
    if (!env) return true
    const next = new Set(active).add(fn)
    const contexts = boundHttpContexts(fn, call, context, checker)
    if (!contexts) return true
    if (extension?.node === fn) contexts.push(extension.thisParameter)
    let escaped = false
    const accounted = createContextAccountedEmissionProof(fn, checker)
    const direct = values.callbacks.resolve(call.expression, new Map())?.node === fn
    const visitBound = (node: ts.Node): void => {
      if (ts.isIfStatement(node)) {
        const condition = values.resolve(node.expression, env)
        if (
          condition?.length &&
          condition.every(
            (value) => value === null || value.node.kind === ts.SyntaxKind.FalseKeyword,
          )
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
              (nested) =>
                !calleeEscapes(
                  nested,
                  call,
                  symbol,
                  checker,
                  next,
                  env,
                  env,
                  values,
                  root,
                  rootContext,
                ),
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
          opaque(node, checker, symbol, next, env, fn, values, root, rootContext),
        )
      )
        escaped = true
    }
    contextCallbackExecutionRoots(fn, call, callerEnv, checker, contexts).forEach(visitBound)
    return escaped
  }

  return calleeEscapes
}
