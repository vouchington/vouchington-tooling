import { someSseArgumentValue } from './protocol-sse-literal-arguments.mts'
import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { expressionReceiver, type WriteReceiver } from './protocol-write-receiver.mts'

/** Preserve only exact selected formal, captured, and returned-property receiver bindings. */
export function selectedSseBodyReceivers(
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression,
  indices: readonly number[],
  properties: readonly string[],
  captured: readonly WriteReceiver[],
  checker: ts.TypeChecker,
): WriteReceiver[] | undefined {
  const parameters = runtimeParameters(fn)
  const selected: WriteReceiver[] = [...captured]
  for (const index of indices) {
    const parameter = parameters[index]
    const symbol = parameter && checker.getSymbolAtLocation(parameter.name)
    if (
      !symbol ||
      !parameter ||
      !ts.isIdentifier(parameter.name) ||
      parameter.dotDotDotToken ||
      parameter.initializer ||
      !call.arguments[index] ||
      ts.isSpreadElement(call.arguments[index]!)
    )
      return undefined
    selected.push({ root: symbol, path: [] })
  }
  for (const propertyName of properties) {
    const returns = returnedExpressions(fn)
    if (!returns.length) return undefined
    for (const expression of returns) {
      const value = expression && unwrapExpression(expression)
      if (!value || !ts.isObjectLiteralExpression(value)) return undefined
      const members = value.properties.filter(
        (member) =>
          !ts.isSpreadAssignment(member) &&
          member.name &&
          (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
          member.name.text === propertyName,
      )
      if (value.properties.some(ts.isSpreadAssignment) || members.length !== 1) return undefined
      const member = members[0]!
      const receiver: WriteReceiver | undefined = ts.isPropertyAssignment(member)
        ? expressionReceiver(member.initializer, checker)
        : ts.isShorthandPropertyAssignment(member)
          ? (() => {
              const symbol = checker.getShorthandAssignmentValueSymbol(member)
              return symbol && { root: symbol, path: [] }
            })()
          : undefined
      if (!receiver || receiver.mutableAlias) return undefined
      selected.push(receiver)
    }
  }
  return selected.length ? selected : undefined
}

export function containsSelectedSseValue(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  matches: (expression: ts.Expression) => WriteReceiver | undefined,
  touches: (expression: ts.Expression) => boolean,
): boolean {
  return someSseArgumentValue(expression, checker, (value) => {
    const type = checker.getTypeAtLocation(value)
    const f = ts.TypeFlags
    const primitive = f.StringLike | f.NumberLike | f.BooleanLike | f.BigIntLike | f.ESSymbolLike
    return !!matches(value) || (touches(value) && !(type.flags & primitive))
  })
}

export function selectedSseBodyMutation(
  node: ts.Node,
  touches: (expression: ts.Expression) => boolean,
  contains: (expression: ts.Expression) => boolean,
): boolean {
  return (
    (ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      ts.isExpression(node.left) &&
      (touches(node.left) || contains(node.right))) ||
    ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      touches(node.operand)) ||
    (ts.isNewExpression(node) && node.arguments?.some(contains)) ||
    (ts.isDeleteExpression(node) && touches(node.expression))
  )
}
