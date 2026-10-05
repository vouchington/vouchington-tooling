import ts from '../contract-schema/typescript-api.mts'

export type Assignment = { node: ts.BinaryExpression; direct: boolean; start: number }

/**
 * Memoized protocol-proof results for one analysis run. Nodes are immutable, so every entry stays
 * valid for the run; callers create one per run and drop it afterwards.
 */
export type ProtocolCache = {
  /** Plain assignments per owning function (or source file), grouped by the symbol they write. */
  assignments: Map<ts.Node, Map<ts.Symbol, Assignment[]>>
  /** Symbols written (assigned, updated, or looped over) anywhere in a source file. */
  writtenSymbols: Map<ts.SourceFile, Set<ts.Symbol | undefined>>
  /** Whether a function is a supported protocol callback. */
  supported: Map<ts.Node, boolean>
  /** Executable call expressions of a source file. */
  calls: Map<ts.SourceFile, ts.CallExpression[]>
}

export const createProtocolCache = (): ProtocolCache => ({
  assignments: new Map(),
  writtenSymbols: new Map(),
  supported: new Map(),
  calls: new Map(),
})
