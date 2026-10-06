import ts from '../contract-schema/typescript-api.mts'
import { httpContextInvocations } from './protocol-http-context-callers.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { contextResponseMethod, methodAccess } from './protocol-http-method-access.mts'
import { reflectHttpResponseMethod } from './protocol-http-reflect.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import {
  contextLiteralBinding,
  constructedContextCapture,
} from './protocol-http-context-literal-captures.mts'
import { contextResultBranches } from './protocol-http-context-result-branches.mts'
import { httpContextContainerMembers } from './protocol-http-context-container-members.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
export { contextResponseMethod } from './protocol-http-method-access.mts'

/** A helper parameter is a response context only when every executable caller passes one. */
export function httpHandlerContext(
  fn: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
  active = new Set<ts.FunctionLikeDeclaration>(),
): ts.Symbol | undefined {
  if (active.has(fn)) return undefined
  const parameter = runtimeParameters(fn)[0]
  const context =
    parameter && ts.isIdentifier(parameter.name)
      ? checker.getSymbolAtLocation(parameter.name)
      : undefined
  if (!context || hasBindingWrite(parameter!, checker)) return undefined
  const { registered, callers } = httpContextInvocations(fn, checker)
  const next = new Set(active).add(fn)
  const valid =
    (registered || callers.length > 0) &&
    callers.every((call) => {
      const argument = call.arguments[0]
      const receiver = argument && expressionReceiver(argument, checker)
      const declaration = receiver?.root.valueDeclaration
      const owner =
        declaration && ts.isParameter(declaration) ? enclosingFunction(declaration) : undefined
      return (
        !!owner &&
        !!receiver &&
        receiver.path.length === 0 &&
        !receiver.mutableAlias &&
        receiver.root === httpHandlerContext(owner, checker, next)
      )
    })
  const result = valid ? context : undefined
  return result
}

/** Follow only caller contexts already admitted by the actual-argument proof. */
export function httpContextScopes(fn: ts.FunctionLikeDeclaration, checker: ts.TypeChecker) {
  const scopes = new Map<ts.FunctionLikeDeclaration, ts.Symbol>()
  const pending = [fn]
  const seen = new Set<ts.FunctionLikeDeclaration>()
  while (pending.length) {
    const current = pending.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    const context = httpHandlerContext(current, checker)
    if (!context) continue
    scopes.set(current, context)
    for (const call of httpContextInvocations(current, checker).callers) {
      // Admission above proves every caller's parameter-owned context.
      const receiver = expressionReceiver(call.arguments[0]!, checker)!
      pending.push(enclosingFunction(receiver.root.valueDeclaration!)!)
    }
  }
  return scopes
}

/** Indirect methods cannot prove the declared status or body, including borrowed this receivers. */
export function indirectHttpResponseMethod(
  call: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
) {
  const reflected = reflectHttpResponseMethod(call, context, checker)
  if (reflected) return reflected
  const outer = methodAccess(call.expression)
  if (!outer || !['call', 'apply', 'bind'].includes(outer.name)) return undefined
  const direct = contextResponseMethod(outer.receiver, context, checker, true)
  if (direct) return direct
  const method = expressionReceiver(outer.receiver, checker)
  if (method?.root === context)
    return method.path[0] === 'response' ? method.path.slice(0, 2).join('.') : method.path[0]
  const receiver = call.arguments[0] && expressionReceiver(call.arguments[0], checker)
  if (receiver?.root !== context) return undefined
  const target = methodAccess(outer.receiver)
  const name = target?.name ?? method?.path.at(-1)
  if (!name) return undefined
  return receiver.path.length === 0
    ? name
    : receiver.path.length === 1 && receiver.path[0] === 'response'
      ? `response.${name}`
      : undefined
}

export function httpContextArgument(
  expression: ts.Expression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
): boolean {
  if (seen.has(expression)) return false
  const next = new Set(seen).add(expression)
  const literal = contextLiteralBinding(unwrapExpression(expression), checker)
  if (literal) return httpContextArgument(literal, context, checker, next)
  const branches = contextResultBranches(unwrapExpression(expression))
  if (branches.length)
    return branches.some((value) => httpContextArgument(value, context, checker, next))
  const receiver = expressionReceiver(expression, checker)
  return (
    (receiver?.root === context && ['', 'response'].includes(receiver.path.join('.'))) ||
    contextResponseMethod(unwrapExpression(expression), context, checker, true) === 'response'
  )
}

/** Constructors receiving a selected context cannot establish a bounded body/status proof. */
export function opaqueHttpContextConstruction(
  node: ts.Node,
  checker: ts.TypeChecker,
  context: ts.Symbol,
  boundHandler?: ts.Node,
): boolean {
  return (
    ts.isNewExpression(node) &&
    executableProtocolPath(node, checker, boundHandler) &&
    (!!node.arguments?.some(
      (argument) =>
        httpContextArgument(argument, context, checker) ||
        wrappedHttpContextArgument(argument, context, checker),
    ) ||
      constructedContextCapture(
        node,
        checker,
        (value) =>
          httpContextArgument(value, context, checker) ||
          wrappedHttpContextArgument(value, context, checker),
      ))
  )
}

/** Literal containers expose a selected context even when a foreign parameter is not direct. */
export function wrappedHttpContextArgument(
  expression: ts.Expression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  captured?: (fn: ts.SignatureDeclaration) => boolean,
): boolean {
  const value = unwrapExpression(expression)
  const branches = contextResultBranches(value)
  if (branches.length)
    return branches.some((branch) => wrappedHttpContextArgument(branch, context, checker, captured))
  if (ts.isSpreadElement(value))
    return (
      httpContextArgument(value.expression, context, checker) ||
      wrappedHttpContextArgument(value.expression, context, checker, captured)
    )
  const members = httpContextContainerMembers(value)
  if (!members) return false
  let found = false
  function visit(node: ts.Node) {
    if (!potentiallyExecuted(node)) return
    if (ts.isFunctionLike(node)) {
      if (captured?.(node)) found = true
      return
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      if (checker.getShorthandAssignmentValueSymbol(node) === context) found = true
    } else if (ts.isExpression(node) && httpContextArgument(node, context, checker)) {
      found = true
      return
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return
    ts.forEachChild(node, visit)
  }
  members.forEach(visit)
  return found
}
