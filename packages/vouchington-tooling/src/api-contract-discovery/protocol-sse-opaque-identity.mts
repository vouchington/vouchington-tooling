import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import {
  ownerAssignedOnlyAfter,
  ownerHasFreshAllocation,
} from './protocol-sse-owner-allocation.mts'
import { argumentMayReachFutureOwner } from './protocol-sse-future-owner.mts'
import { freshStreamAllocation } from './protocol-sse-fresh-factory.mts'
import { independentArgumentOrigin } from './protocol-sse-independent-origin.mts'
import {
  expressionReceiver,
  sameWriteReceiver,
  type WriteReceiver,
} from './protocol-write-receiver.mts'

function selectedStreamHasFreshOrigin(receiver: WriteReceiver, checker: ts.TypeChecker): boolean {
  if (ownerHasFreshAllocation(receiver, checker)) return true
  const declaration = receiver.root.valueDeclaration
  return (
    receiver.path.length === 0 &&
    declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    !!(declaration.parent.flags & ts.NodeFlags.Const) &&
    declaration.initializer !== undefined &&
    freshStreamAllocation(declaration.initializer, checker)
  )
}

function argumentMayContainSelectedSource(
  actual: WriteReceiver,
  selected: WriteReceiver,
  checker: ts.TypeChecker,
): boolean {
  const declaration = actual.root.valueDeclaration
  if (!declaration) return false
  const mayProduceSelected = (expression: ts.Expression): boolean => {
    const value = unwrapExpression(expression)
    if (ts.isConditionalExpression(value))
      return mayProduceSelected(value.whenTrue) || mayProduceSelected(value.whenFalse)
    const receiver = expressionReceiver(value, checker)
    return receiver !== undefined && sameWriteReceiver(receiver, selected)
  }
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    if (mayProduceSelected(declaration.initializer)) return true
  }
  const owner = enclosingFunction(declaration)
  if (!owner) return false
  let assignedFromSelected = false
  const inspect = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      checker.getSymbolAtLocation(node.left) === actual.root &&
      mayProduceSelected(node.right)
    )
      assignedFromSelected = true
    if (!assignedFromSelected) node.forEachChild(inspect)
  }
  inspect(owner)
  return assignedFromSelected
}

/** Preserve unknown aliases unless the selected stream cannot be the passed value. */
export function opaqueArgumentExcludesSelectedStream(
  call: ts.CallExpression | ts.NewExpression,
  argument: ts.Expression,
  actual: WriteReceiver,
  selected: readonly WriteReceiver[],
  checker: ts.TypeChecker,
): boolean {
  const argumentType = checker.getTypeAtLocation(argument)
  return selected.every((frame) => {
    if (sameWriteReceiver(frame, actual)) return false
    if (argumentMayContainSelectedSource(actual, frame, checker)) return false
    if (ownerAssignedOnlyAfter(call, frame, checker))
      return !argumentMayReachFutureOwner(actual, frame, checker)
    if (
      frame.root === actual.root ||
      (actual.root.valueDeclaration && ts.isBindingElement(actual.root.valueDeclaration))
    )
      return false
    if (
      !independentArgumentOrigin(actual, checker, frame) &&
      !selectedStreamHasFreshOrigin(actual, checker)
    )
      return false
    return (
      selectedStreamHasFreshOrigin(frame, checker) &&
      !(argumentType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Intersection))
    )
  })
}
