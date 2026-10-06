import ts from '../contract-schema/typescript-api.mts'
import { httpContextInvocations } from './protocol-http-context-callers.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { createHttpContextValueResolver } from './protocol-http-context-values.mts'
import { isProtocolCallbackFunction, type CallbackBindings } from './protocol-callback-values.mts'
import { standardReflectApply } from './protocol-http-reflect.mts'

type CalleeEscapeProof = (
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  active: Set<ts.FunctionLikeDeclaration>,
  callerEnv: CallbackBindings,
  captured: CallbackBindings,
  values: ReturnType<typeof createHttpContextValueResolver>,
  root: ts.CallExpression,
) => boolean

export function implementedHttpContextCallee(
  call: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  active: Set<ts.FunctionLikeDeclaration>,
  callerEnv: CallbackBindings,
  values: ReturnType<typeof createHttpContextValueResolver>,
  root: ts.CallExpression,
  calleeEscapes: CalleeEscapeProof,
): boolean {
  const resolver = values.callbacks
  if (values.weakMembership(call, context)) return true
  const extension = values.extension(call, context, root)
  if (extension)
    return !calleeEscapes(
      extension.node,
      call,
      context,
      checker,
      active,
      callerEnv,
      extension.env,
      values,
      root,
    )
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
