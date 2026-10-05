import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { factoryCreatesFreshSelectedStream } from './protocol-sse-fresh-factory.mts'
import { independentArgumentOrigin } from './protocol-sse-independent-origin.mts'
import {
  expressionReceiver,
  sameWriteReceiver,
  type WriteReceiver,
} from './protocol-write-receiver.mts'

function hasRepeatingAncestor(node: ts.Node, owner: ts.Node): boolean {
  for (let parent = node.parent; parent && parent !== owner; parent = parent.parent)
    if (
      ts.isForStatement(parent) ||
      ts.isForInStatement(parent) ||
      ts.isForOfStatement(parent) ||
      ts.isWhileStatement(parent) ||
      ts.isDoStatement(parent)
    )
      return true
  return false
}

function receiverType(receiver: WriteReceiver, checker: ts.TypeChecker): ts.Type | undefined {
  const declaration = receiver.root.valueDeclaration
  if (!declaration) return undefined
  let type = checker.getTypeOfSymbolAtLocation(receiver.root, declaration)
  for (const part of receiver.path) {
    const property = checker.getPropertyOfType(checker.getNonNullableType(type), part)
    if (!property) return undefined
    type = checker.getTypeOfSymbolAtLocation(property, declaration)
  }
  return checker.getNonNullableType(type)
}

/** A selected owner with no initializer cannot exist before its sole assignment. */
function ownerAssignedOnlyAfter(
  call: ts.CallExpression,
  receiver: WriteReceiver,
  checker: ts.TypeChecker,
): boolean {
  const declaration = receiver.root.valueDeclaration
  const bindingOwner =
    declaration &&
    ts.isBindingElement(declaration) &&
    ts.isVariableDeclaration(declaration.parent.parent)
      ? declaration.parent.parent
      : undefined
  const bindingProperty =
    declaration && ts.isBindingElement(declaration)
      ? (declaration.propertyName ?? declaration.name)
      : undefined
  if (
    declaration &&
    bindingOwner &&
    bindingProperty &&
    ts.isIdentifier(bindingProperty) &&
    bindingOwner.initializer &&
    ts.isVariableDeclarationList(bindingOwner.parent) &&
    !!(bindingOwner.parent.flags & ts.NodeFlags.Const) &&
    ts.isCallExpression(unwrapExpression(bindingOwner.initializer)) &&
    declaration.getSourceFile() === call.getSourceFile() &&
    enclosingFunction(declaration) === enclosingFunction(call) &&
    declaration.getStart() > call.getEnd() &&
    !hasRepeatingAncestor(declaration, enclosingFunction(declaration)!) &&
    factoryCreatesFreshSelectedStream(
      unwrapExpression(bindingOwner.initializer) as ts.CallExpression,
      bindingProperty.text,
      checker,
    )
  )
    return true
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer ||
    declaration.getSourceFile() !== call.getSourceFile()
  )
    return false
  const owner = enclosingFunction(declaration)
  if (!owner || enclosingFunction(call) !== owner) return false
  let assignment: ts.BinaryExpression | undefined
  let invalidWrite = false
  const writesOwner = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === receiver.root) return true
    return node.getChildren().some(writesOwner)
  }
  const inspect = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const left = node.left
      if (writesOwner(left)) {
        if (
          node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
          !ts.isIdentifier(left) ||
          assignment
        )
          invalidWrite = true
        else assignment = node
      }
    }
    if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && writesOwner(node.initializer))
      invalidWrite = true
    node.forEachChild(inspect)
  }
  inspect(owner)
  return (
    !invalidWrite &&
    assignment !== undefined &&
    assignment.getStart() > call.getEnd() &&
    !hasRepeatingAncestor(assignment, owner) &&
    receiver.path.length === 1 &&
    ts.isCallExpression(unwrapExpression(assignment.right)) &&
    factoryCreatesFreshSelectedStream(
      unwrapExpression(assignment.right) as ts.CallExpression,
      receiver.path[0]!,
      checker,
    )
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
  call: ts.CallExpression,
  argument: ts.Expression,
  actual: WriteReceiver,
  selected: readonly WriteReceiver[],
  checker: ts.TypeChecker,
): boolean {
  const argumentType = checker.getTypeAtLocation(argument)
  return selected.every((frame) => {
    if (sameWriteReceiver(frame, actual)) return false
    if (argumentMayContainSelectedSource(actual, frame, checker)) return false
    if (ownerAssignedOnlyAfter(call, frame, checker)) return true
    if (
      frame.root === actual.root ||
      (actual.root.valueDeclaration && ts.isBindingElement(actual.root.valueDeclaration))
    )
      return false
    if (!independentArgumentOrigin(actual, checker)) return false
    const selectedType = receiverType(frame, checker)
    return (
      selectedType !== undefined &&
      !(selectedType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) &&
      !(
        argumentType.flags &
        (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Intersection)
      ) &&
      !checker.isTypeAssignableTo(selectedType, argumentType) &&
      !checker.isTypeAssignableTo(argumentType, selectedType)
    )
  })
}
