import ts from '../contract-schema/typescript-api.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import {
  enclosingRouteBinding,
  type HandlerBindings,
  type RouteBinding,
} from './response-contract-route-analysis.mts'
import {
  expressionReceiver,
  sameWriteReceiver,
  type WriteReceiver,
} from './protocol-write-receiver.mts'

export function routeKey(binding: RouteBinding): string {
  return `${binding.method}:${binding.routeTemplate}`
}

function implementationDeclaration(
  declaration: ts.Signature['declaration'],
  checker: ts.TypeChecker,
): ts.FunctionLikeDeclaration | undefined {
  if (!declaration) return undefined
  if (ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) return declaration
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) {
    if (declaration.body) return declaration
    const symbol = declaration.name && checker.getSymbolAtLocation(declaration.name)
    return symbol?.declarations?.find(
      (candidate): candidate is ts.FunctionLikeDeclaration =>
        (ts.isFunctionDeclaration(candidate) || ts.isMethodDeclaration(candidate)) &&
        !!candidate.body,
    )
  }
  return undefined
}

function implementationCall(call: ts.CallExpression, checker: ts.TypeChecker) {
  return (
    implementationDeclaration(checker.getResolvedSignature(call)?.declaration, checker) ??
    createProtocolCallbackValueResolver(checker).resolve(call.expression, new Map())?.node
  )
}

export function opaqueCallReceivesSelectedStream(
  call: ts.CallExpression,
  selectedReceivers: readonly WriteReceiver[],
  binding: RouteBinding,
  calls: readonly ts.CallExpression[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
): boolean {
  const implementation = implementationCall(call, checker)
  if (implementation && ts.isFunctionLike(implementation) && 'body' in implementation) return false
  const framed = selectedReceivers.flatMap((receiver) =>
    actualReceivers(receiver, binding, calls, checker, bindings),
  )
  return call.arguments.some((argument) => {
    const receiver = expressionReceiver(argument, checker)
    if (!receiver) return false
    return actualReceivers(receiver, binding, calls, checker, bindings).some(
      (value) =>
        value === undefined ||
        framed.some((frame) => frame === undefined || sameWriteReceiver(frame, value)),
    )
  })
}

export function helperBindings(
  node: ts.Node,
  calls: readonly ts.CallExpression[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
): RouteBinding[] {
  const fn = enclosingFunction(node)
  if (!fn || fn.asteriskToken) return []
  return calls.flatMap((call) => {
    if (implementationCall(call, checker) !== fn || !executableProtocolPath(call, checker))
      return []
    const binding = enclosingRouteBinding(call, checker, bindings, false)
    return binding ? [binding] : []
  })
}

export function actualReceivers(
  receiver: WriteReceiver,
  binding: RouteBinding,
  calls: readonly ts.CallExpression[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  active = new Set<ts.Symbol>(),
): (WriteReceiver | undefined)[] {
  const declaration = receiver.root.valueDeclaration
  if (
    receiver.mutableAlias ||
    (declaration &&
      (ts.isBindingElement(declaration) ||
        (ts.isVariableDeclaration(declaration) &&
          !(declaration.parent.flags & ts.NodeFlags.Const)) ||
        (ts.isParameter(declaration) && hasBindingWrite(declaration, checker))))
  )
    return [undefined]
  const fn = declaration && enclosingFunction(declaration)
  if (!declaration || !ts.isParameter(declaration) || !fn) return [receiver]
  if (active.has(receiver.root)) return [undefined]
  const index = runtimeParameters(fn).indexOf(declaration)
  const actuals = calls.flatMap((call) => {
    if (implementationCall(call, checker) !== fn || !executableProtocolPath(call, checker))
      return []
    const callBinding = enclosingRouteBinding(call, checker, bindings, false)
    if (!callBinding || routeKey(callBinding) !== routeKey(binding)) return []
    const argument = call.arguments[index] ?? declaration.initializer
    const actual = argument && expressionReceiver(argument, checker)
    if (!actual || receiver.path.length) return [undefined]
    return actualReceivers(
      actual,
      binding,
      calls,
      checker,
      bindings,
      new Set(active).add(receiver.root),
    )
  })
  return actuals.length ? actuals : [receiver]
}
