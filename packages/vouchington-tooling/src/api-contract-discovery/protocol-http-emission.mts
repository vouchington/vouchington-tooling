import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'

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
  return method.name.text === 'from' &&
    isNodeReadable(symbol) &&
    expression.arguments[0] &&
    responseProperty(expression.arguments[0], response, 'body', checker)
    ? 'content'
    : undefined
}

export function contextResponseMethod(
  expression: ts.Expression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  allowMutable = false,
): string | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined
  const receiver = expressionReceiver(expression.expression, checker)
  if (receiver?.root !== context || (receiver.mutableAlias && !allowMutable)) return undefined
  if (receiver.path.length === 0) return expression.name.text
  if (receiver.path.length === 1 && receiver.path[0] === 'response')
    return `response.${expression.name.text}`
  return undefined
}

/** Mutable context wrappers cannot establish a complete response contract. */
export function unsupportedContextResponse(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): boolean {
  const handler = enclosingFunction(call)
  const name = handler && runtimeParameters(handler)[0]?.name
  const context = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
  if (!context) return false
  const method = contextResponseMethod(call.expression, context, checker, true)
  return (
    method !== undefined &&
    ['setStatus', 'pipeline', 'json', 'response.buffer', 'response.empty'].includes(method) &&
    contextResponseMethod(call.expression, context, checker) === undefined
  )
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
    if (ts.isIfStatement(parent)) {
      const condition = unwrapExpression(parent.expression)
      if (
        parent.thenStatement === current &&
        ts.isPrefixUnaryExpression(condition) &&
        condition.operator === ts.SyntaxKind.ExclamationToken &&
        responseProperty(condition.operand, response, 'body', checker)
      )
        return true
      if (
        parent.elseStatement === current &&
        responseProperty(condition, response, 'body', checker)
      )
        return true
    }
    current = parent
  }
  return false
}

function isNodeReadable(symbol: ts.Symbol | undefined): boolean {
  return !!symbol?.declarations?.some((declaration) => {
    if (!ts.isImportSpecifier(declaration)) return false
    const imported = declaration.propertyName ?? declaration.name
    const statement = declaration.parent.parent.parent
    return (
      imported.text === 'Readable' &&
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'node:stream'
    )
  })
}
