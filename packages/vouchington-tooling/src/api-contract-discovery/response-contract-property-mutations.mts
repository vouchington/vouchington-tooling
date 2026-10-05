import ts from '../contract-schema/typescript-api.mts'

import { attributionSymbol, resolveSymbol } from './response-contract-symbols.mts'
import { unwrapTransparentExpression, visit } from './response-contract-route-syntax.mts'

/** Direct syntactic property writes are excluded; indirect mutation is outside this proof. */
export function findMutatedProperties(
  sourceFiles: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): Set<ts.Symbol> {
  const mutated = new Set<ts.Symbol>()
  for (const sourceFile of sourceFiles) {
    visit(sourceFile, (node) => {
      let access: ts.PropertyAccessExpression | undefined
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        ts.isPropertyAccessExpression(unwrapTransparentExpression(node.left))
      )
        access = unwrapTransparentExpression(node.left) as ts.PropertyAccessExpression
      else if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        ts.isPropertyAccessExpression(node.operand)
      )
        access = node.operand
      if (!access) return
      const symbol = checker.getSymbolAtLocation(access.name)
      if (symbol) mutated.add(attributionSymbol(resolveSymbol(symbol, checker), checker))
    })
  }
  return mutated
}

/** Direct identifier and destructuring writes are excluded; indirect writes are unproven. */
export function findMutatedBindings(
  sourceFiles: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): Set<ts.Symbol> {
  const mutated = new Set<ts.Symbol>()
  for (const sourceFile of sourceFiles) {
    visit(sourceFile, (node) => {
      let identifiers: ts.Identifier[] = []
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        isAssignmentTarget(node.left)
      )
        identifiers = assignmentTargetIdentifiers(node.left)
      else if (
        (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
        !ts.isVariableDeclarationList(node.initializer) &&
        isAssignmentTarget(node.initializer)
      )
        identifiers = assignmentTargetIdentifiers(node.initializer)
      else if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        ts.isIdentifier(node.operand)
      )
        identifiers = [node.operand]
      for (const identifier of identifiers) {
        const symbol = checker.getSymbolAtLocation(identifier)
        if (symbol) mutated.add(attributionSymbol(resolveSymbol(symbol, checker), checker))
      }
    })
  }
  return mutated
}

function isAssignmentTarget(expression: ts.Expression): boolean {
  const target = unwrapTransparentExpression(expression)
  return (
    ts.isIdentifier(target) ||
    ts.isArrayLiteralExpression(target) ||
    ts.isObjectLiteralExpression(target)
  )
}

function assignmentTargetIdentifiers(expression: ts.Expression): ts.Identifier[] {
  const target = unwrapTransparentExpression(expression)
  if (ts.isIdentifier(target)) return [target]
  if (ts.isArrayLiteralExpression(target))
    return target.elements.flatMap((element) =>
      ts.isOmittedExpression(element)
        ? []
        : assignmentTargetIdentifiers(ts.isSpreadElement(element) ? element.expression : element),
    )
  if (!ts.isObjectLiteralExpression(target)) return []
  const identifiers: ts.Identifier[] = []
  for (const property of target.properties) {
    if (ts.isShorthandPropertyAssignment(property)) identifiers.push(property.name)
    else if (ts.isPropertyAssignment(property))
      identifiers.push(...assignmentTargetIdentifiers(property.initializer))
    else if (ts.isSpreadAssignment(property))
      identifiers.push(...assignmentTargetIdentifiers(property.expression))
  }
  return identifiers
}
