import ts from '../contract-schema/typescript-api.mts'

/** A cached lookup keyed by node or symbol; `undefined` results are cached too. */
function memoize<K, V>(lookup: (key: K) => V): (key: K) => V {
  const cache = new Map<K, V>()
  return (key) => {
    if (cache.has(key)) return cache.get(key)!
    const value = lookup(key)
    cache.set(key, value)
    return value
  }
}

/**
 * A checker whose symbol lookups are memoized for one analysis run. The walker resolves the same
 * identifiers and aliases for every route that reaches a shared helper; the program is immutable,
 * so the answers cannot change. The cache dies with the returned object.
 */
export function memoizeCheckerSymbols(checker: ts.TypeChecker): ts.TypeChecker {
  return {
    ...checker,
    getSymbolAtLocation: memoize((node: ts.Node) => checker.getSymbolAtLocation(node)),
    getShorthandAssignmentValueSymbol: memoize((node: ts.Node | undefined) =>
      checker.getShorthandAssignmentValueSymbol(node),
    ),
    getAliasedSymbol: memoize((symbol: ts.Symbol) => checker.getAliasedSymbol(symbol)),
  }
}
