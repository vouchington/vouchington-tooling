import ts from '../contract-schema/typescript-api.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { contextResponseMethod } from './protocol-http-emission.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
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
  let fn = enclosingFunction(call)
  let context: ts.Symbol | undefined
  const callbacks: ts.CallExpression[] = []
  while (fn) {
    if (!potentiallyExecuted(fn) || !potentiallyExecuted(call))
      throw new Error('SSE frame is not on an executable callback path')
    if (fn.asteriskToken) throw new Error('SSE frame is in a deferred generator')
    if (ts.isFunctionDeclaration(fn)) {
      if (!ts.isSourceFile(fn.parent)) throw new Error('SSE frame is in a deferred local function')
      const name = fn.parameters[0]?.name
      if (name && ts.isIdentifier(name)) context = checker.getSymbolAtLocation(name)
    } else {
      let value: ts.Node = fn
      while (ts.isPropertyAssignment(value.parent) || ts.isObjectLiteralExpression(value.parent))
        value = value.parent
      if (!ts.isCallExpression(value.parent))
        throw new Error('SSE frame is in an uninvoked callback')
      callbacks.push(value.parent)
      if (
        ts.isPropertyAccessExpression(value.parent.expression) &&
        ['get', 'post', 'put', 'patch', 'delete'].includes(value.parent.expression.name.text)
      ) {
        const name = fn.parameters[0]?.name
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
  if (status.unavailableReason) throw new Error(status.unavailableReason)
  return { write, receiver, status }
}
