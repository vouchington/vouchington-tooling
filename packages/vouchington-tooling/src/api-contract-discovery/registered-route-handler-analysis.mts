import ts from '../contract-schema/typescript-api.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'

export function handlerNodes(
  argument: ts.Expression,
  checker: ts.TypeChecker,
  parameterBindings = new Map<ts.Symbol, ts.Expression>(),
  active = new Set<ts.Node>(),
  staticProof = false,
): ts.Node[] {
  const unwrapped = unwrapHandlerExpression(argument)
  if (unwrapped !== argument)
    return handlerNodes(unwrapped, checker, parameterBindings, active, staticProof)
  let bound = argument
  const boundIdentifiers = new Set<ts.Node>()
  while (ts.isIdentifier(bound)) {
    const symbol = checker.getSymbolAtLocation(bound)
    const nextArgument = symbol && parameterBindings.get(symbol)
    if (!nextArgument) break
    if (boundIdentifiers.has(bound)) return []
    boundIdentifiers.add(bound)
    bound = nextArgument
  }
  if (bound !== argument)
    return handlerNodes(bound, checker, parameterBindings, active, staticProof)
  if (active.has(argument)) return []
  const next = new Set(active).add(argument)
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return [argument]
  if (ts.isCallExpression(argument)) {
    return callableImplementations(argument.expression, checker, staticProof).flatMap(
      (implementation) => {
        if (
          staticProof &&
          implementation.parameters.some((parameter) => hasBindingWrite(parameter, checker))
        )
          return []
        const bindings = new Map(parameterBindings)
        implementation.parameters.forEach((parameter, index) => {
          const callArgument = argument.arguments[index]
          const symbol = checker.getSymbolAtLocation(parameter.name)
          if (callArgument && symbol) bindings.set(symbol, callArgument)
        })
        return returnedExpressions(implementation).flatMap((returnedExpression) =>
          handlerNodes(returnedExpression, checker, bindings, next, staticProof),
        )
      },
    )
  }
  return declarationImplementations(argument, checker, next, staticProof)
}

export function callableImplementations(
  node: ts.Node,
  checker: ts.TypeChecker,
  staticProof = false,
): ts.FunctionLikeDeclaration[] {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return []
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const implementations: ts.FunctionLikeDeclaration[] = []
  for (const declaration of resolved.declarations ?? []) {
    if (staticProof && !hasStableBinding(declaration, checker)) continue
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initializer = unwrapHandlerExpression(declaration.initializer)
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        implementations.push(initializer)
      continue
    }
    if (
      (ts.isFunctionDeclaration(declaration) ||
        (!staticProof && ts.isMethodDeclaration(declaration))) &&
      declaration.body
    )
      implementations.push(declaration)
  }
  return implementations
}

function returnedExpressions(declaration: ts.FunctionLikeDeclaration): ts.Expression[] {
  const body = declaration.body!
  if (!ts.isBlock(body)) return [body]
  const returned: ts.Expression[] = []
  const collect = (node: ts.Node): void => {
    if (node !== declaration && ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node)) {
      if (node.expression) returned.push(node.expression)
      return
    }
    node.forEachChild(collect)
  }
  body.forEachChild(collect)
  return returned
}

function declarationImplementations(
  node: ts.Node,
  checker: ts.TypeChecker,
  active: Set<ts.Node>,
  staticProof: boolean,
): ts.Node[] {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return []
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  return (resolved.declarations ?? []).flatMap((declaration) => {
    if (staticProof && !hasStableBinding(declaration, checker)) return []
    if (
      ts.isFunctionDeclaration(declaration) ||
      (!staticProof && ts.isMethodDeclaration(declaration))
    )
      return declaration.body ? [declaration] : []
    if (ts.isVariableDeclaration(declaration) && declaration.initializer)
      return [
        declaration,
        ...handlerNodes(declaration.initializer, checker, new Map(), active, staticProof),
      ]
    return []
  })
}

function hasStableBinding(declaration: ts.Declaration, checker: ts.TypeChecker): boolean {
  if (ts.isVariableDeclaration(declaration))
    return (
      ts.isVariableDeclarationList(declaration.parent) &&
      !!(declaration.parent.flags & ts.NodeFlags.Const)
    )
  return !ts.isFunctionDeclaration(declaration) || !hasBindingWrite(declaration, checker)
}

function unwrapHandlerExpression(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression
  return node
}
