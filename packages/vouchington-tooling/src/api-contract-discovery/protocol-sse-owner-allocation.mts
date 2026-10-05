import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { factoryCreatesFreshSelectedStream } from './protocol-sse-fresh-factory.mts'
import type { WriteReceiver } from './protocol-write-receiver.mts'

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

/** A selected owner with no initializer cannot exist before its sole assignment. */
export function ownerAssignedOnlyAfter(
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
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      writesOwner(node.operand)
    )
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
