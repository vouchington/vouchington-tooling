import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import type { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import type { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'

/** Associate only actual top-level producer callers with their unchanged application binding. */
export function createContextExtensionApplication(
  checker: ts.TypeChecker,
  calls: readonly ts.CallExpression[],
  writes: readonly ts.Expression[],
  roots: ReturnType<typeof createContextValueRoots>,
  resolver: ReturnType<typeof createProtocolCallbackValueResolver>,
) {
  const applicationCache = new Map<ts.Symbol, ts.Symbol | undefined>()
  function applicationOf(value: ts.Expression, seen = new Set<ts.Symbol>()): ts.Symbol | undefined {
    const symbol = roots.root(value)
    if (!symbol || seen.has(symbol)) return undefined
    if (applicationCache.has(symbol)) return applicationCache.get(symbol)
    const declaration = symbol.valueDeclaration
    if (!declaration || writes.some((write) => roots.referencesContainer(write, symbol)))
      return undefined
    if (!ts.isParameter(declaration)) return symbol
    const owner = enclosingFunction(declaration)
    if (!owner) return undefined
    const index = runtimeParameters(owner).indexOf(declaration)
    const callers = calls.filter(
      (call) =>
        !enclosingFunction(call) && resolver.resolve(call.expression, new Map())?.node === owner,
    )
    const next = new Set(seen).add(symbol)
    const applications = callers.map(
      (call) => call.arguments[index] && applicationOf(call.arguments[index]!, next),
    )
    const result =
      applications[0] && applications.every((app) => app === applications[0])
        ? applications[0]
        : undefined
    applicationCache.set(symbol, result)
    return result
  }
  return applicationOf
}
