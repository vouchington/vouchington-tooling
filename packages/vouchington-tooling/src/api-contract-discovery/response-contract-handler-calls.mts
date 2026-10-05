import ts from '../contract-schema/typescript-api.mts'

import { executableProtocolPath } from './protocol-execution-path.mts'
import { attributionSymbol, resolveSymbol } from './response-contract-symbols.mts'
import { propertyImplementationSymbol } from './response-contract-object-symbols.mts'
import {
  isInlineRouteHandler,
  unwrapTransparentExpression,
} from './response-contract-route-syntax.mts'

export function handlerArgumentSymbols(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  unwrapArguments = false,
  mutatedProperties?: ReadonlySet<ts.Symbol>,
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
      const mutatedSymbol = mutatedPropertyAccessSymbol(argument, checker, mutatedProperties)
      if (mutatedSymbol) {
        symbols.push(mutatedSymbol)
        continue
      }
      const symbol = propertyImplementationSymbol(argument, checker)
      if (symbol) symbols.push(symbol)
      continue
    }
    if (!isFunctionLike(argument)) continue
    visitHandlerCalls(argument, argument, checker, unwrapArguments, (child) => {
      const callee = unwrapArguments
        ? unwrapTransparentExpression(child.expression)
        : child.expression
      const mutatedSymbol = mutatedPropertyAccessSymbol(callee, checker, mutatedProperties)
      if (mutatedSymbol) {
        symbols.push(mutatedSymbol)
        return
      }
      const symbol = handlerSymbol(callee, checker, unwrapArguments)
      if (symbol) symbols.push(symbol)
    })
  }
  return symbols
}

export function isMutatedPropertyAccess(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  mutatedProperties: ReadonlySet<ts.Symbol> | undefined,
): boolean {
  return !!mutatedPropertyAccessSymbol(expression, checker, mutatedProperties)
}

function mutatedPropertyAccessSymbol(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  mutatedProperties: ReadonlySet<ts.Symbol> | undefined,
): ts.Symbol | undefined {
  if (!mutatedProperties || !ts.isPropertyAccessExpression(expression)) return undefined
  const contextual = checker.getSymbolAtLocation(expression.name)
  return contextual &&
    mutatedProperties.has(attributionSymbol(resolveSymbol(contextual, checker), checker))
    ? contextual
    : undefined
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
  if (node !== root && isInlineRouteHandler(node)) return
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

function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}
