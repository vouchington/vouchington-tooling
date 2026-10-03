import ts from '../contract-schema/typescript-api.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { isSupportedProtocolCallback } from './protocol-callback-invocation.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { unsupportedContextAlias } from './protocol-context-alias.mts'
import { contextResponseMethod } from './protocol-http-emission.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { statusDominatesEmission } from './protocol-status-dominance.mts'
import { visit } from './response-contract-route-analysis.mts'
import { writeReceiver } from './protocol-write-receiver.mts'
import { resolveEmissionStatus } from './response-contract-status.mts'

export function sseEmission(call: ts.CallExpression, checker: ts.TypeChecker) {
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
  let status = context
    ? resolveEmissionStatus(
        write,
        (expression) => contextResponseMethod(expression, context!, checker) === 'setStatus',
      )
    : resolveEmissionStatus(write)
  if (context && status.statusKnowledge === 'default') {
    for (const callback of callbacks) {
      status = resolveEmissionStatus(
        callback,
        (expression) => contextResponseMethod(expression, context!, checker) === 'setStatus',
      )
      if (status.statusKnowledge !== 'default') break
    }
  }
  if (context) {
    const setters = new Set<ts.CallExpression>()
    for (const fn of functions)
      visit(fn, (node) => {
        if (
          ts.isVariableDeclaration(node) &&
          functions.includes(enclosingFunction(node)!) &&
          potentiallyExecuted(node) &&
          unsupportedContextAlias(node, context!, checker)
        )
          throw new Error('SSE context has an unsupported mutable or destructured alias')
        if (
          ts.isCallExpression(node) &&
          functions.includes(enclosingFunction(node)!) &&
          potentiallyExecuted(node) &&
          contextResponseMethod(node.expression, context!, checker) === 'setStatus'
        )
          setters.add(node)
      })
    for (const setter of setters) {
      if (
        ![write, ...callbacks].some((anchor) => statusDominatesEmission(anchor, new Set([setter])))
      )
        throw new Error('SSE status does not dominate its frame emission')
    }
  }
  if (status.unavailableReason) throw new Error(status.unavailableReason)
  return { write, receiver, status }
}
