import ts from '../contract-schema/typescript-api.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { isSupportedProtocolCallback } from './protocol-callback-invocation.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import type { HandlerBindings, RouteBinding } from './response-contract-route-analysis.mts'
import { sseCallerScope } from './protocol-sse-callers.mts'
import { resolveSseStatus } from './protocol-sse-status.mts'
import { writeReceiver } from './protocol-write-receiver.mts'

export function sseEmission(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  calls: readonly ts.CallExpression[],
  binding: RouteBinding,
  bindings: HandlerBindings,
) {
  const write = call.parent
  if (
    !ts.isCallExpression(write) ||
    !ts.isPropertyAccessExpression(write.expression) ||
    write.expression.name.text !== 'write' ||
    write.arguments[0] !== call
  )
    throw new Error('apiSseFrame must be the frame written by its route')
  const receiver = writeReceiver(write, checker)
  if (!receiver) throw new Error('SSE frame requires a bound stream receiver')
  if (receiver.mutableAlias) throw new Error('SSE frame uses a mutable stream alias')
  let fn = enclosingFunction(call)
  let context: ts.Symbol | undefined
  const callbacks: (ts.CallExpression | ts.NewExpression)[] = []
  const functions: ts.FunctionLikeDeclaration[] = []
  while (fn) {
    functions.push(fn)
    if (!potentiallyExecuted(fn) || !potentiallyExecuted(call))
      throw new Error('SSE frame is not on an executable callback path')
    if (fn.asteriskToken) throw new Error('SSE frame is in a deferred generator')
    if (!isSupportedProtocolCallback(fn, checker))
      throw new Error('SSE frame is in an uninvoked callback')
    if (ts.isFunctionDeclaration(fn)) {
      const name = runtimeParameters(fn)[0]?.name
      if (name && ts.isIdentifier(name)) context = checker.getSymbolAtLocation(name)
    } else {
      let value: ts.Node = fn
      while (ts.isPropertyAssignment(value.parent) || ts.isObjectLiteralExpression(value.parent))
        value = value.parent
      if (ts.isCallExpression(value.parent) || ts.isNewExpression(value.parent))
        callbacks.push(value.parent)
      if (
        (ts.isCallExpression(value.parent) &&
          ts.isPropertyAccessExpression(value.parent.expression) &&
          ['get', 'post', 'put', 'patch', 'delete'].includes(value.parent.expression.name.text)) ||
        (ts.isVariableDeclaration(fn.parent) && !enclosingFunction(fn))
      ) {
        const name = runtimeParameters(fn)[0]?.name
        if (name && ts.isIdentifier(name)) context = checker.getSymbolAtLocation(name)
      }
    }
    fn = enclosingFunction(fn)
  }
  const caller = sseCallerScope(functions, calls, binding, bindings, checker)
  const anchors = [write, ...callbacks]
  const paths = caller ? caller.paths.map((path) => [...anchors, ...path]) : [anchors]
  const contexts = caller?.contexts ?? new Set(context ? [context] : [])
  const status = resolveSseStatus(
    paths,
    [...new Set([...functions, ...(caller?.functions ?? [])])],
    contexts,
    checker,
  )
  return { write, receiver, status }
}
