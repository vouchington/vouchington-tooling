import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

export function httpEmissionKind(
  call: ts.CallExpression,
  response: ts.Symbol,
  context: ts.Symbol,
  checker: ts.TypeChecker,
): 'content' | 'none' | 'status' | undefined {
  const methodName = contextResponseMethod(call.expression, context, checker)
  if (
    methodName === 'setStatus' &&
    call.arguments[0] &&
    responseProperty(call.arguments[0], response, 'status', checker)
  )
    return 'status'
  if (methodName === 'response.empty' && emptyBodyBranch(call, response, checker)) return 'none'
  if (!(methodName === 'pipeline' || methodName === 'response.buffer')) return undefined
  const body = call.arguments[0]
  if (!body) return undefined
  const expression = unwrapExpression(body)
  if (responseProperty(expression, response, 'body', checker)) return 'content'
  if (!ts.isCallExpression(expression) || expression.arguments.length > 1) return undefined
  const method = expression.expression
  if (!ts.isPropertyAccessExpression(method)) return undefined
  if (
    expression.arguments.length === 0 &&
    ['arrayBuffer', 'text'].includes(method.name.text) &&
    ts.isIdentifier(method.expression) &&
    checker.getSymbolAtLocation(method.expression) === response
  )
    return 'content'
  const symbol = checker.getSymbolAtLocation(method.expression)
  const resolved =
    symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
  return method.name.text === 'from' &&
    resolved?.name === 'Readable' &&
    expression.arguments[0] &&
    responseProperty(expression.arguments[0], response, 'body', checker)
    ? 'content'
    : undefined
}

export function contextResponseMethod(
  expression: ts.Expression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
): string | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined
  const receiver = unwrapExpression(expression.expression)
  if (ts.isIdentifier(receiver) && checker.getSymbolAtLocation(receiver) === context)
    return expression.name.text
  if (
    ts.isPropertyAccessExpression(receiver) &&
    receiver.name.text === 'response' &&
    ts.isIdentifier(receiver.expression) &&
    checker.getSymbolAtLocation(receiver.expression) === context
  )
    return `response.${expression.name.text}`
  return undefined
}

function responseProperty(
  expression: ts.Expression,
  response: ts.Symbol,
  property: string,
  checker: ts.TypeChecker,
): boolean {
  const value = unwrapExpression(expression)
  return (
    ts.isPropertyAccessExpression(value) &&
    value.name.text === property &&
    ts.isIdentifier(value.expression) &&
    checker.getSymbolAtLocation(value.expression) === response
  )
}

function emptyBodyBranch(node: ts.Node, response: ts.Symbol, checker: ts.TypeChecker): boolean {
  let current: ts.Node = node
  while (current.parent && !ts.isFunctionLike(current.parent)) {
    const parent = current.parent
    if (ts.isIfStatement(parent) && parent.thenStatement === current) {
      const condition = unwrapExpression(parent.expression)
      if (
        ts.isPrefixUnaryExpression(condition) &&
        condition.operator === ts.SyntaxKind.ExclamationToken &&
        responseProperty(condition.operand, response, 'body', checker)
      )
        return true
    }
    current = parent
  }
  return false
}
