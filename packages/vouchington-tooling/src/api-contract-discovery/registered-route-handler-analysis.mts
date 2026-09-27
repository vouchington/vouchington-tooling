import ts from '../contract-schema/typescript-api.mts'

export function handlerNodes(
  argument: ts.Expression,
  checker: ts.TypeChecker,
  parameterBindings = new Map<ts.Symbol, ts.Expression>(),
): ts.Node[] {
  if (ts.isIdentifier(argument)) {
    const symbol = checker.getSymbolAtLocation(argument)
    const boundArgument = symbol && parameterBindings.get(symbol)
    if (boundArgument) return handlerNodes(boundArgument, checker, parameterBindings)
  }
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return [argument]
  if (ts.isCallExpression(argument)) {
    return callableImplementations(argument.expression, checker).flatMap((implementation) => {
      const bindings = new Map(parameterBindings)
      implementation.parameters.forEach((parameter, index) => {
        const callArgument = argument.arguments[index]
        const symbol = checker.getSymbolAtLocation(parameter.name)
        if (callArgument && symbol) bindings.set(symbol, callArgument)
      })
      return returnedExpressions(implementation).flatMap((returnedExpression) =>
        handlerNodes(returnedExpression, checker, bindings),
      )
    })
  }
  return declarationImplementations(argument, checker)
}

function callableImplementations(
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.FunctionLikeDeclaration[] {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return []
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const implementations: ts.FunctionLikeDeclaration[] = []
  for (const declaration of resolved.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initializer = declaration.initializer
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        implementations.push(initializer)
      continue
    }
    if (
      (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) &&
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

function declarationImplementations(node: ts.Node, checker: ts.TypeChecker): ts.Node[] {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return []
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  return (resolved.declarations ?? []).flatMap((declaration) => {
    if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration))
      return declaration.body ? [declaration] : []
    if (ts.isVariableDeclaration(declaration) && declaration.initializer)
      return [declaration, ...handlerNodes(declaration.initializer, checker)]
    return []
  })
}
