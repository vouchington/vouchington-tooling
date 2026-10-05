import ts from '../contract-schema/typescript-api.mts'
import {
  httpHandlerContext,
  contextResponseMethod,
  httpContextArgument,
} from './protocol-http-context.mts'
import { httpContextInvocations } from './protocol-http-context-callers.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
import { createHttpContextValueResolver } from './protocol-http-context-values.mts'
import type { CallbackBindings } from './protocol-callback-values.mts'
import { standardReflectApply } from './protocol-http-reflect.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import { receiverUsesThis } from './protocol-http-context-receiver.mts'
import { unsupportedBoundContextNode } from './protocol-http-context-bound-nodes.mts'
import { createContextAccountedEmissionProof } from './protocol-http-context-accounted-emissions.mts'

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
  const matches = (symbol: ts.Symbol) =>
    call.arguments.some((argument) => httpContextArgument(argument, symbol, checker))
  if (context && !matches(context)) return false
  if (
    !(
      executableProtocolPath(call, checker, boundHandler) ||
      opaqueProtocolCallbackPath(call, checker)
    )
  )
    return false
  if (context) return !implementedCallee(call, context, checker, active, env, proof, root)
  for (let owner = enclosingFunction(call); owner; owner = enclosingFunction(owner)) {
    const name = runtimeParameters(owner)[0]?.name
    const symbol = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
    if (symbol && matches(symbol) && httpHandlerContext(owner, checker) === symbol)
      return !implementedCallee(call, symbol, checker, active, env, proof, root)
  }
  return false
}

/** Actual caller bindings retain the concrete implementations of consumed callback parameters. */
function implementedCallee(
  call: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  active: Set<ts.FunctionLikeDeclaration>,
  callerEnv: CallbackBindings,
  values: ReturnType<typeof createHttpContextValueResolver>,
  root: ts.CallExpression,
): boolean {
  const resolver = values.callbacks
  if (standardReflectApply(call, checker)) {
    const target = call.arguments[0] && resolver.resolve(call.arguments[0], new Map())
    return !!(
      target &&
      isProtocolCallbackFunction(target.node) &&
      target.node.body &&
      ts.isBlock(target.node.body) &&
      target.node.body.statements.length === 0
    )
  }
  const implemented = (env: CallbackBindings) => {
    const targets = values.resolve(call.expression, env)
    return (
      !!targets?.length &&
      targets.every(
        (target) =>
          !!target &&
          isProtocolCallbackFunction(target.node) &&
          !!target.node.body &&
          !calleeEscapes(
            target.node,
            call,
            context,
            checker,
            active,
            env,
            target.env,
            values,
            root,
          ),
      )
    )
  }
  if (implemented(callerEnv)) return true
  let expression = unwrapExpression(call.expression)
  while (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    expression = unwrapExpression(expression.expression)
  const declaration = ts.isIdentifier(expression)
    ? checker.getSymbolAtLocation(expression)?.valueDeclaration
    : undefined
  const owner =
    declaration && ts.isParameter(declaration) ? enclosingFunction(declaration) : undefined
  if (!owner || !runtimeParameters(owner).includes(declaration as ts.ParameterDeclaration))
    return false
  const callers = httpContextInvocations(owner, checker).callers
  return (
    callers.length > 0 &&
    callers.every((invocation) => {
      const target = resolver.resolve(invocation.expression, new Map())
      if (target?.node !== owner) return false
      const env = callbackArgumentBindings(
        owner,
        invocation,
        new Map(),
        target.env,
        checker,
        resolver,
      )
      return !!env && implemented(env)
    })
  )
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
  if (
    ts.isPropertyAccessExpression(call.expression) ||
    ts.isElementAccessExpression(call.expression)
  ) {
    if (!ts.isArrowFunction(fn) && receiverUsesThis(fn.body!)) return true
  }
  const resolver = values.callbacks
  const env = callbackArgumentBindings(fn, call, callerEnv, captured, checker, resolver)
  if (!env) return true
  const next = new Set(active).add(fn)
  const contexts = [context]
  for (const [index, parameter] of runtimeParameters(fn).entries()) {
    const argument = call.arguments[index]
    if (!argument || !httpContextArgument(argument, context, checker)) continue
    if (!ts.isIdentifier(parameter.name)) return true
    contexts.push(checker.getSymbolAtLocation(parameter.name)!)
  }
  let escaped = false
  const accounted = createContextAccountedEmissionProof(fn, checker)
  const visitBound = (node: ts.Node): void => {
    if (ts.isIfStatement(node)) {
      const condition = values.resolve(node.expression, env)
      if (
        condition?.length &&
        condition.every((value) => value === null || value.node.kind === ts.SyntaxKind.FalseKeyword)
      ) {
        if (node.elseStatement) visitBound(node.elseStatement)
        return
      }
    }
    inspect(node)
    ts.forEachChild(node, visitBound)
  }
  const inspect = (node: ts.Node): void => {
    if (contexts.some((symbol) => unsupportedBoundContextNode(node, symbol, checker, fn)))
      escaped = true
    if (
      ts.isCallExpression(node) &&
      executableProtocolPath(node, checker, fn) &&
      contexts.some(
        (symbol) =>
          ['json', 'pipeline', 'response.buffer'].includes(
            contextResponseMethod(node.expression, symbol, checker, true) ?? '',
          ) &&
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
  visitBound(fn.body!)
  return escaped
}
