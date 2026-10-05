import ts from '../contract-schema/typescript-api.mts'
import type { HandlerProof } from './registered-route-handler-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { resolveKey } from './request-validation-keys.mts'
import type { Bound } from './request-validation-origin.mts'

/** Static keys bound by the proof, and the handler's own context parameter as the root. */
export function handlerBindings(proof: HandlerProof, checker: ts.TypeChecker) {
  const keys = new Map<ts.Symbol, string>()
  for (const [symbol, expression] of proof.bindings) {
    const key = resolveKey(expression, checker, new Map())
    if (key !== undefined) keys.set(symbol, key)
  }
  const context = runtimeParameters(proof.node)[0]?.name
  const symbol =
    context && ts.isIdentifier(context) ? checker.getSymbolAtLocation(context) : undefined
  const roots = new Map<ts.Symbol, Bound>(
    symbol ? [[symbol, { kind: 'context', origins: [] }]] : [],
  )
  return { keys, roots }
}
