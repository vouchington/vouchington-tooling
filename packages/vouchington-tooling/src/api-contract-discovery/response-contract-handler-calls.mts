import ts from '../contract-schema/typescript-api.mts'

import { executableProtocolPath } from './protocol-execution-path.mts'
import { propertyImplementationSymbol } from './response-contract-symbols.mts'
import {
  propertyName,
  routeTemplateFromExpression,
  unwrapTransparentExpression,
} from './response-contract-route-syntax.mts'

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export function handlerArgumentSymbols(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  unwrapArguments = false,
): ts.Symbol[] {
  const symbols: ts.Symbol[] = []
  for (const originalArgument of node.arguments) {
    const argument = unwrapArguments
      ? unwrapTransparentExpression(originalArgument)
      : originalArgument
    if (ts.isIdentifier(argument)) {
      const symbol = checker.getSymbolAtLocation(argument)
      if (symbol) symbols.push(symbol)
      continue
    }
    if (unwrapArguments && ts.isPropertyAccessExpression(argument)) {
      const symbol = propertyImplementationSymbol(argument, checker)
      if (symbol) symbols.push(symbol)
      continue
    }
    if (!isFunctionLike(argument)) continue
    visitHandlerCalls(argument, argument, checker, unwrapArguments, (child) => {
      const callee = unwrapArguments
        ? unwrapTransparentExpression(child.expression)
        : child.expression
      const symbol = handlerSymbol(callee, checker, unwrapArguments)
      if (symbol) symbols.push(symbol)
    })
  }
  return symbols
}

function handlerSymbol(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  resolvePropertyImplementation: boolean,
): ts.Symbol | undefined {
  if (resolvePropertyImplementation && ts.isPropertyAccessExpression(expression))
    return propertyImplementationSymbol(expression, checker)
  return checker.getSymbolAtLocation(expression)
}

function visitHandlerCalls(
  node: ts.Node,
  root: ts.Node,
  checker: ts.TypeChecker,
  attributeNestedCalls: boolean,
  onCall: (node: ts.CallExpression) => void,
): void {
  if (node !== root && isRouteHandlerFunction(node)) return
  const callee = ts.isCallExpression(node)
    ? attributeNestedCalls
      ? unwrapTransparentExpression(node.expression)
      : node.expression
    : undefined
  if (
    ts.isCallExpression(node) &&
    !!callee &&
    (ts.isIdentifier(callee) || (attributeNestedCalls && ts.isPropertyAccessExpression(callee))) &&
    executableProtocolPath(node, checker, attributeNestedCalls ? root : undefined)
  )
    onCall(node)
  ts.forEachChild(node, (child) =>
    visitHandlerCalls(child, root, checker, attributeNestedCalls, onCall),
  )
}

function isRouteHandlerFunction(node: ts.Node): boolean {
  if (!isFunctionLike(node) || !ts.isCallExpression(node.parent)) return false
  const method = propertyName(node.parent.expression)?.toUpperCase()
  return (
    !!method && HTTP_METHODS.has(method) && !!routeTemplateFromExpression(node.parent.expression)
  )
}

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}
