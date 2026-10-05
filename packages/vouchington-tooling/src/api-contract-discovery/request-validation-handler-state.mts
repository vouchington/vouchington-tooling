import ts from '../contract-schema/typescript-api.mts'
import type { HandlerProof } from './registered-route-handler-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { resolveKey } from './request-validation-keys.mts'
import { memberKind, type Bound, type RootKind } from './request-validation-origin.mts'

/** Binds a context parameter, or each destructured member of it, to the carrier it denotes. */
function bindContext(
  name: ts.BindingName,
  kind: RootKind,
  checker: ts.TypeChecker,
  roots: Map<ts.Symbol, Bound>,
) {
  if (ts.isIdentifier(name)) {
    roots.set(checker.getSymbolAtLocation(name)!, { kind, origins: [] })
    return
  }
  if (!ts.isObjectBindingPattern(name)) return
  for (const element of name.elements) {
    const key = element.propertyName ?? element.name
    const member =
      !element.dotDotDotToken && (ts.isIdentifier(key) || ts.isStringLiteral(key))
        ? memberKind(kind, key.text)
        : undefined
    if (member) bindContext(element.name, member, checker, roots)
  }
}

/** Static keys bound by the proof (each resolved against the earlier ones), and the handler's own context parameter as the root. */
export function handlerBindings(proof: HandlerProof, checker: ts.TypeChecker) {
  const keys = new Map<ts.Symbol, string>()
  for (const [symbol, expression] of proof.bindings) {
    const key = resolveKey(expression, checker, keys)
    if (key !== undefined) keys.set(symbol, key)
  }
  const roots = new Map<ts.Symbol, Bound>()
  const context = runtimeParameters(proof.node)[0]?.name
  if (context) bindContext(context, 'context', checker, roots)
  return { keys, roots }
}
