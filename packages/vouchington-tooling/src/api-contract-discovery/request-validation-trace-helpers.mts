import ts from '../contract-schema/typescript-api.mts'
import { isConditionalPosition } from './request-validation-conditional.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import type { Assignment, ProtocolCache } from './protocol-analysis-cache.mts'
import type { Followable } from './request-validation-follow.mts'

const owningFunction = (node: ts.Node) => {
  let current = node.parent
  while (current && !ts.isFunctionLike(current)) current = current.parent
  return current
}

function writtenSymbol(left: ts.Expression, checker: ts.TypeChecker) {
  let current = left
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
    current = current.expression
  return ts.isIdentifier(current) ? checker.getSymbolAtLocation(current) : undefined
}

/** True when the node may not run, within its function: conditional branches and `try` blocks. */
function maybeSkipped(node: ts.Node): boolean {
  if (isConditionalPosition(node)) return true
  let child = node
  for (let parent = node.parent; parent && !ts.isFunctionLike(parent); parent = parent.parent) {
    if (ts.isTryStatement(parent) && child === parent.tryBlock) return true
    child = parent
  }
  return false
}

/** Plain assignments to the symbol within the scope, excluding nested functions, in source order. */
function assignmentsTo(
  scope: ts.Node,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  cache: ProtocolCache | undefined,
): Assignment[] {
  let bySymbol = cache?.assignments.get(scope)
  if (!bySymbol) {
    const found = new Map<ts.Symbol, Assignment[]>()
    const scan = (node: ts.Node): void => {
      if (node !== scope && ts.isFunctionLike(node)) return
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const written = writtenSymbol(node.left, checker)
        const entry = { node, direct: ts.isIdentifier(node.left), start: node.getStart() }
        if (written) found.set(written, [...(found.get(written) ?? []), entry])
      }
      ts.forEachChild(node, scan)
    }
    scan(scope)
    bySymbol = found
    cache?.assignments.set(scope, bySymbol)
  }
  return bySymbol.get(symbol) ?? []
}

/**
 * The assignments that can supply a value at the use: property writes, plus reassignments of the
 * identifier itself made earlier in the same function. An unconditional reassignment replaces
 * everything before it, including the initializer; conditional ones merge.
 */
export function reachingWrites(
  use: ts.Node,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  cache?: ProtocolCache,
): { writes: ts.Expression[]; initializer: boolean } {
  const scope = owningFunction(use) ?? use.getSourceFile()
  const before = use.getStart()
  const entries = assignmentsTo(scope, symbol, checker, cache).filter(
    (entry) => entry.start < before && (!entry.direct || entry.node.getEnd() <= before),
  )
  const killer = entries.findLast((entry) => entry.direct && !maybeSkipped(entry.node))
  const kept = entries.filter(
    (entry) => !entry.direct || !killer || entries.indexOf(entry) >= entries.indexOf(killer),
  )
  return { writes: kept.map((entry) => entry.node.right), initializer: !killer }
}

/** Returned expressions of a function, including an arrow function's expression body. */
export function returnedValues(fn: Followable): ts.Node[] {
  const body = fn.body!
  if (!ts.isBlock(body)) return [body]
  const values: ts.Node[] = []
  const scan = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node) && node.expression && potentiallyExecuted(node.expression))
      values.push(node.expression)
    ts.forEachChild(node, scan)
  }
  ts.forEachChild(body, scan)
  return values
}
