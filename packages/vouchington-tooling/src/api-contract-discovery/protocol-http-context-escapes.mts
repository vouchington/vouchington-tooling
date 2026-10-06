import ts from '../contract-schema/typescript-api.mts'
import {
  httpHandlerContext,
  httpContextArgument,
  wrappedHttpContextArgument,
  contextResponseMethod,
} from './protocol-http-context.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { standardCompilerDeclaration } from './protocol-platform-callbacks.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
import { createHttpContextValueResolver } from './protocol-http-context-values.mts'
import type { CallbackBindings } from './protocol-callback-values.mts'
import { createContextForwardedArguments } from './protocol-http-context-forwarded-target.mts'
import { implementedHttpContextCallee as implementedCallee } from './protocol-http-context-implemented-callee.mts'
import { opaqueWrappedHttpContextArgument } from './protocol-http-context-callable-captures.mts'
import { createHttpContextCalleeEscapeProof } from './protocol-http-context-callee-escapes.mts'
const calleeEscapes = createHttpContextCalleeEscapeProof(opaqueHttpContextArgument)
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
  rootContext = context,
): boolean {
  const arguments_ = createContextForwardedArguments(checker)(call)
  const invoked = unwrapExpression(call.expression)
  const directEval =
    !call.questionDotToken &&
    ts.isIdentifier(invoked) &&
    invoked.text === 'eval' &&
    checker
      .getSymbolAtLocation(invoked)
      ?.declarations?.every((declaration) => standardCompilerDeclaration(declaration, checker))
  const receiver =
    ts.isPropertyAccessExpression(invoked) || ts.isElementAccessExpression(invoked)
      ? invoked.expression
      : undefined
  const directReceiver = (symbol: ts.Symbol) => {
    if (!receiver || !httpContextArgument(receiver, symbol, checker)) return false
    if (proof.platformMethod(call, symbol)) return false
    // Canonical protocol calls retain their existing emission and mutation proofs.
    const method = contextResponseMethod(invoked, symbol, checker, true)
    return ![
      'assert',
      'setStatus',
      'json',
      'pipeline',
      'response.buffer',
      'response.empty',
      'response.xml',
    ].includes(method ?? '')
  }
  const matches = (symbol: ts.Symbol) =>
    arguments_.some((argument) => httpContextArgument(argument, symbol, checker)) ||
    directReceiver(symbol) ||
    (!!receiver && wrappedHttpContextArgument(receiver, symbol, checker))
  if (
    !(
      executableProtocolPath(call, checker, boundHandler) ||
      opaqueProtocolCallbackPath(call, checker)
    )
  )
    return false
  if (context && directEval) return true
  if (context) {
    const safeCapture = (fn: ts.FunctionLikeDeclaration) =>
      !calleeEscapes(fn, call, context, checker, active, env, env, proof, root, rootContext)
    if (opaqueWrappedHttpContextArgument(call, context, checker, proof.callbacks, env, safeCapture))
      return true
  }
  if (context && !matches(context)) return false
  const escapes = (selected: ts.Symbol) =>
    !implementedCallee(
      call,
      selected,
      checker,
      active,
      env,
      proof,
      root,
      calleeEscapes,
      rootContext,
    )
  if (context) return escapes(context)
  for (let owner = enclosingFunction(call); owner; owner = enclosingFunction(owner)) {
    const name = runtimeParameters(owner)[0]?.name
    const symbol = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
    if (symbol && (directEval || matches(symbol)) && httpHandlerContext(owner, checker) === symbol)
      return !!directEval || escapes(symbol)
  }
  return false
}
