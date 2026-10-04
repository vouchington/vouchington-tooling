import ts from '../contract-schema/typescript-api.mts'
import {
  httpHandlerContext,
  httpContextScopes,
  indirectHttpResponseMethod,
} from './protocol-http-context.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { httpEmissionKind, contextResponseMethod } from './protocol-http-emission.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { unsupportedContextAlias } from './protocol-context-alias.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { visit } from './response-contract-route-analysis.mts'
import { isSupportedProtocolCallback } from './protocol-callback-invocation.mts'
import { mutatesHttpResponseMethod } from './protocol-http-method-mutations.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
import { opaqueHttpContextArgument } from './protocol-http-context-escapes.mts'

const responseMethods = new Set([
  'setStatus',
  'pipeline',
  'json',
  'response.buffer',
  'response.empty',
])

export function associateHttpResponse(
  call: ts.CallExpression,
  response: ts.Symbol,
  checker: ts.TypeChecker,
  siblings?: ReadonlySet<ts.Symbol>,
): Map<ts.CallExpression, 'content' | 'none' | 'status'> {
  const handler = enclosingFunction(call)
  const handlerContext = handler && httpHandlerContext(handler, checker)
  if (!handler || !handlerContext) throw new Error('HTTP response must bind the handler context')
  if (!executableProtocolPath(call, checker))
    throw new Error('HTTP response must be inside a supported executable handler callback')
  const emissions = new Map<ts.CallExpression, 'content' | 'none' | 'status'>()
  for (const [scope, context] of httpContextScopes(handler, checker))
    visit(scope, (node) => {
      if (ts.isCallExpression(node) && opaqueHttpContextArgument(node, checker, context))
        throw new Error('HTTP response context escapes through an opaque argument')
      if (mutatesHttpResponseMethod(node, context, checker))
        throw new Error('HTTP response context method is mutated')
      if (
        ts.isCallExpression(node) &&
        executableProtocolPath(node, checker) &&
        responseMethods.has(indirectHttpResponseMethod(node, context, checker) ?? '')
      )
        throw new Error('HTTP response has an unsupported indirect status or body emission')
      if (ts.isCallExpression(node) && opaqueHttpResponse(node, checker, context))
        throw new Error('HTTP response context escapes through an opaque callback')
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        executableProtocolPath(node, checker)
      ) {
        const receiver = expressionReceiver(node.right, checker)
        if (
          receiver?.root === context &&
          (receiver.path.length === 0 ||
            (receiver.path.length === 1 && receiver.path[0] === 'response'))
        )
          throw new Error('HTTP response context has an unsupported mutable alias')
      }
      if (
        ts.isVariableDeclaration(node) &&
        enclosingFunction(node) === scope &&
        unsupportedContextAlias(node, context, checker)
      )
        throw new Error('HTTP response context has an unsupported mutable or destructured alias')
      if (!ts.isCallExpression(node) || !executableProtocolPath(node, checker)) return
      const kind =
        enclosingFunction(node) === handler
          ? httpEmissionKind(node, response, context, checker)
          : undefined
      if (kind) emissions.set(node, kind)
      else if (
        responseMethods.has(contextResponseMethod(node.expression, context, checker, true) ?? '') &&
        (enclosingFunction(node) === scope ||
          !!contextResponseMethod(node.expression, context, checker))
      )
        if (
          siblings &&
          [...siblings].some(
            (symbol) => symbol !== response && !!httpEmissionKind(node, symbol, context, checker),
          )
        )
          return
        else throw new Error('HTTP response has an unrelated status or body emission')
    })
  return emissions
}

/** Opaque callbacks may emit through an independently proven handler's context. */
export function opaqueHttpResponse(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  context?: ts.Symbol,
): boolean {
  if (opaqueHttpContextArgument(call, checker, context)) return true
  if (context)
    return (
      responseMethods.has(
        contextResponseMethod(call.expression, context, checker, true) ??
          indirectHttpResponseMethod(call, context, checker) ??
          '',
      ) && opaqueProtocolCallbackPath(call, checker)
    )
  return !!supportedResponseContext(call, checker) && opaqueProtocolCallbackPath(call, checker)
}

/** Mutable wrappers on supported callback paths cannot establish a complete contract. */
export function unsupportedContextResponse(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): boolean {
  if (!executableProtocolPath(call, checker)) return false
  const context = supportedResponseContext(call, checker)
  return !!context && contextResponseMethod(call.expression, context, checker) === undefined
}

export function supportedResponseContext(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  let handler = enclosingFunction(call)
  while (handler) {
    const name = runtimeParameters(handler)[0]?.name
    const symbol = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
    if (
      symbol &&
      responseMethods.has(
        contextResponseMethod(call.expression, symbol, checker, true) ??
          indirectHttpResponseMethod(call, symbol, checker) ??
          '',
      ) &&
      httpHandlerContext(handler, checker) === symbol &&
      isSupportedProtocolCallback(handler, checker) &&
      executableProtocolPath(handler, checker)
    )
      return symbol
    handler = enclosingFunction(handler)
  }
  return undefined
}
