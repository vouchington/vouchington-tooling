import { contextMutationTargets } from './protocol-http-context-write-targets.mts'
import { mutatorKind } from './protocol-platform-mutation-targets.mts'
import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { ownerHasFreshAllocation } from './protocol-sse-owner-allocation.mts'
import { argumentMayReachFutureOwner } from './protocol-sse-future-owner.mts'
import { symbolBindingWritten } from './protocol-sse-binding-writes.mts'
import { expressionReceiver, type WriteReceiver } from './protocol-write-receiver.mts'

/** A retained value cannot initially contain this invocation's later fresh stream allocation. */
export function predatesSelectedSseAllocation(
  actual: WriteReceiver,
  selected: WriteReceiver,
  checker: ts.TypeChecker,
): boolean {
  if (
    actual.mutableAlias ||
    actual.root === selected.root ||
    !ownerHasFreshAllocation(selected, checker) ||
    argumentMayReachFutureOwner(actual, selected, checker)
  )
    return false
  const declaration = actual.root.valueDeclaration
  const owner = selected.root.valueDeclaration
  if (
    !declaration ||
    !owner ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const) ||
    symbolBindingWritten(declaration.getSourceFile(), actual.root, checker, true)
  )
    return false
  let changed = false
  const inspect = (node: ts.Node): void => {
    const targets = contextMutationTargets(node)
    if (ts.isCallExpression(node) && mutatorKind(node, checker, undefined) && node.arguments[0])
      targets.push(node.arguments[0])
    const touches = (value: ts.Node): boolean =>
      (ts.isExpression(value) && expressionReceiver(value, checker)?.root === actual.root) ||
      value.forEachChild(touches) === true
    if (targets.some(touches)) changed = true
    if (!changed) node.forEachChild(inspect)
  }
  inspect(declaration.getSourceFile())
  if (changed) return false
  // The fresh-owner proof above already establishes its enclosing invocation.
  const fn = enclosingFunction(owner)!
  if (!enclosingFunction(declaration)) return true
  if (enclosingFunction(declaration) !== fn) return false
  let allocation: ts.Node | undefined
  if (ts.isBindingElement(owner) && ts.isVariableDeclaration(owner.parent.parent))
    allocation = owner.parent.parent.initializer
  else if (ts.isVariableDeclaration(owner)) {
    allocation = owner.initializer
    if (!allocation) {
      const visit = (node: ts.Node): void => {
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          expressionReceiver(node.left, checker)?.root === selected.root
        )
          allocation = unwrapExpression(node.right)
        node.forEachChild(visit)
      }
      visit(fn)
    }
  }
  return !!allocation && declaration.getEnd() < allocation.getStart()
}
