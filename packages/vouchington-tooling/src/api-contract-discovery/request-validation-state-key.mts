import type ts from '../contract-schema/typescript-api.mts'
import type { KeyBindings } from './request-validation-keys.mts'
import type { RootBindings } from './request-validation-origin.mts'

/** A stable identity for the bindings a function is walked with, used to stop repeat walks. */
export function createStateKey() {
  const symbolIds = new Map<ts.Symbol, number>()
  const symbolId = (symbol: ts.Symbol) => {
    if (!symbolIds.has(symbol)) symbolIds.set(symbol, symbolIds.size)
    return symbolIds.get(symbol)
  }
  return (state: { keys: KeyBindings; roots: RootBindings; conditional: boolean }) =>
    [
      ...[...state.keys].map(([symbol, value]) => JSON.stringify(['k', symbolId(symbol), value])),
      ...[...state.roots].map(([symbol, value]) => JSON.stringify(['r', symbolId(symbol), value])),
      JSON.stringify(state.conditional),
    ]
      .toSorted((left, right) => left.localeCompare(right))
      .join('|')
}
