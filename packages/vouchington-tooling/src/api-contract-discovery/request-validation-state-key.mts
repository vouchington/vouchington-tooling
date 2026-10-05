import type ts from '../contract-schema/typescript-api.mts'
import type { KeyBindings } from './request-validation-keys.mts'
import type { RootBindings } from './request-validation-origin.mts'

export type WalkState = {
  keys: KeyBindings
  roots: RootBindings
  conditional: boolean
  /** The calls this walk was entered through, innermost last; a call may build a validator input. */
  via: ReadonlySet<ts.Node>
}

export const emptyState: WalkState = {
  keys: new Map(),
  roots: new Map(),
  conditional: false,
  via: new Set(),
}

/** A stable identity for the bindings a function is walked with, used to stop repeat walks. */
export function createStateKey() {
  const symbolIds = new Map<ts.Symbol, number>()
  const symbolId = (symbol: ts.Symbol) => {
    if (!symbolIds.has(symbol)) symbolIds.set(symbol, symbolIds.size)
    return symbolIds.get(symbol)
  }
  const nodeIds = new Map<ts.Node, number>()
  const nodeId = (node: ts.Node) => {
    if (!nodeIds.has(node)) nodeIds.set(node, nodeIds.size)
    return nodeIds.get(node)
  }
  const bound = (value: unknown) =>
    JSON.stringify(value, (name, item: unknown) =>
      name === 'expression' ? nodeId(item as ts.Node) : item,
    )
  return (state: WalkState) =>
    [
      ...[...state.keys].map(([symbol, value]) => JSON.stringify(['k', symbolId(symbol), value])),
      ...[...state.roots].map(([symbol, value]) => bound(['r', symbolId(symbol), value])),
      JSON.stringify(state.conditional),
      JSON.stringify([...state.via].map(nodeId).toSorted((left, right) => left! - right!)),
    ]
      .toSorted((left, right) => left.localeCompare(right))
      .join('|')
}
