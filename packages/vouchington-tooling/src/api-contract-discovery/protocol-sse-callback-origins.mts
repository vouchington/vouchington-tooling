import ts from '../contract-schema/typescript-api.mts'
import { registeredHandler } from './protocol-callback-registration.mts'
import { isSupportedProtocolCallback } from './protocol-callback-invocation.mts'
import { callbackBindingReplaced, callbackOptionsEscape } from './protocol-callback-mutations.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction,
  protocolCallbackHasWrittenBindings,
  type CallbackBindings,
} from './protocol-callback-values.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { handlerNodes, type HandlerProof } from './registered-route-handler-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import {
  propertyName,
  routeTemplateFromExpression,
  type RouteBinding,
} from './response-contract-route-analysis.mts'

type SseCallbackOrigin = {
  callback: ts.FunctionLikeDeclaration
  call: ts.CallExpression
  binding: RouteBinding
}

/** Reify callback arguments only inside statically selected registered factory handlers. */
export function createSseCallbackOrigins(
  calls: readonly ts.CallExpression[],
  checker: ts.TypeChecker,
) {
  const resolver = createProtocolCallbackValueResolver(checker)
  const invocations: SseCallbackOrigin[] = []
  const handlerCalls = new Set<ts.CallExpression>()
  function regular(fn: ts.FunctionLikeDeclaration): boolean {
    return (
      !fn.asteriskToken &&
      !protocolCallbackHasWrittenBindings(fn, checker) &&
      runtimeParameters(fn).every(
        (parameter) =>
          ts.isIdentifier(parameter.name) && !parameter.dotDotDotToken && !parameter.initializer,
      )
    )
  }
  function inspect(proof: HandlerProof, binding: RouteBinding): void {
    if (!proof.node.body || !regular(proof.node)) return
    const env: CallbackBindings = new Map(
      [...proof.bindings].map(([symbol, node]) => [symbol, { node, env: new Map() }]),
    )
    if (
      [...proof.bindings.keys()].some((symbol) => {
        const parameter = symbol.valueDeclaration
        return (
          !parameter ||
          !ts.isParameter(parameter) ||
          !ts.isIdentifier(parameter.name) ||
          !!parameter.initializer ||
          !!parameter.dotDotDotToken
        )
      })
    )
      return
    const boundArguments = new Set(proof.bindings.values())
    function boundInline(node: ts.Node): boolean {
      for (let current: ts.Node | undefined = node; current; current = current.parent)
        if (boundArguments.has(current as ts.Expression)) return true
      return false
    }
    const found: SseCallbackOrigin[] = []
    const reached: ts.CallExpression[] = []
    let invalid = false
    function visit(node: ts.Node): void {
      if (!executableProtocolPath(node, checker, proof.node)) return
      if (ts.isCallExpression(node)) {
        reached.push(node)
        const value = resolver.resolve(node.expression, env)
        if (
          value &&
          (ts.isArrowFunction(value.node) || ts.isFunctionExpression(value.node)) &&
          isProtocolCallbackFunction(value.node) &&
          value.node.body &&
          boundInline(value.node) &&
          regular(value.node) &&
          isSupportedProtocolCallback(value.node, checker) &&
          !node.arguments.some(ts.isSpreadElement)
        )
          found.push({ callback: value.node, call: node, binding })
      }
      ts.forEachChild(node, visit)
    }
    visit(proof.node.body)
    for (const origin of found) {
      function mutation(node: ts.Node): void {
        if (
          callbackBindingReplaced(node, env, origin.callback, resolver) ||
          ((ts.isCallExpression(node) || ts.isNewExpression(node)) &&
            callbackOptionsEscape(node, env, origin.callback, resolver))
        )
          invalid = true
        ts.forEachChild(node, mutation)
      }
      mutation(proof.node.body)
    }
    if (!invalid) {
      invocations.push(...found)
      reached.forEach((call) => handlerCalls.add(call))
    }
  }
  for (const call of calls) {
    if (!registeredHandler(call)) continue
    const method = propertyName(call.expression)?.toUpperCase()
    const routeTemplate = routeTemplateFromExpression(call.expression)
    if (!method || !routeTemplate) continue
    for (const argument of call.arguments) {
      const proofs: HandlerProof[] = []
      handlerNodes(argument, checker, new Map(), new Set(), true, proofs, true, true)
      proofs.forEach((proof) => inspect(proof, { method, routeTemplate }))
    }
  }
  return { invocations, handlerCalls: [...handlerCalls] }
}
