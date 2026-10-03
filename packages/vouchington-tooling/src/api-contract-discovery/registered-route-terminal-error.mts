import ts from '../contract-schema/typescript-api.mts'

import { callableImplementations } from './registered-route-handler-analysis.mts'

/** Proves a terminal 405 on the handler's own context, rather than finding a nested throw. */
export function isTerminal405Handler(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (
    !(
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) ||
    !node.body
  )
    return false
  const context = node.parameters[0]?.name
  const symbol =
    context && ts.isIdentifier(context) ? checker.getSymbolAtLocation(context) : undefined
  return !!symbol && terminalBody(node, symbol, checker, new Set())
}

function terminalBody(
  node: ts.FunctionLikeDeclaration,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  active: Set<ts.Node>,
): boolean {
  if (!node.body || node.asteriskToken || active.has(node)) return false
  if (
    node.parameters.some(
      (parameter) =>
        !ts.isIdentifier(parameter.name) ||
        parameter.dotDotDotToken ||
        (parameter.initializer && !ts.isLiteralExpression(parameter.initializer)),
    )
  )
    return false
  const next = new Set(active).add(node)
  if (!ts.isBlock(node.body)) return terminalCall(node.body, context, checker, next, true)
  const statements = node.body.statements
  const terminal = statements.at(-1)
  if (
    !terminal ||
    !statements.slice(0, -1).every((statement) => isInertStatement(statement, context, checker))
  )
    return false
  if (ts.isExpressionStatement(terminal))
    return terminalCall(terminal.expression, context, checker, next, false)
  return (
    ts.isReturnStatement(terminal) &&
    !!terminal.expression &&
    terminalCall(terminal.expression, context, checker, next, true)
  )
}

function terminalCall(
  expression: ts.Expression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  active: Set<ts.Node>,
  returned: boolean,
): boolean {
  if (ts.isAwaitExpression(expression))
    return terminalCall(expression.expression, context, checker, active, true)
  if (ts.isParenthesizedExpression(expression))
    return terminalCall(expression.expression, context, checker, active, returned)
  if (!ts.isCallExpression(expression) || expression.questionDotToken) return false
  if (
    expression.arguments.some(
      (argument) => !ts.isIdentifier(argument) && !ts.isLiteralExpression(argument),
    )
  )
    return false
  const callee = expression.expression
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'throw') {
    const status = expression.arguments[0]
    return (
      !callee.questionDotToken &&
      ts.isIdentifier(callee.expression) &&
      checker.getSymbolAtLocation(callee.expression) === context &&
      !!status &&
      ts.isNumericLiteral(status) &&
      Number(status.text) === 405
    )
  }
  if (!ts.isIdentifier(callee)) return false
  const implementations = callableImplementations(callee, checker, true)
  if (!returned && checker.getPropertyOfType(checker.getTypeAtLocation(expression), 'then'))
    return false
  return (
    implementations.length > 0 &&
    implementations.every((implementation) => {
      if (
        !returned &&
        implementation.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      )
        return false
      const index = expression.arguments.findIndex(
        (argument) =>
          ts.isIdentifier(argument) && checker.getSymbolAtLocation(argument) === context,
      )
      const parameter = implementation.parameters[index]?.name
      const symbol =
        parameter && ts.isIdentifier(parameter) ? checker.getSymbolAtLocation(parameter) : undefined
      return !!symbol && terminalBody(implementation, symbol, checker, active)
    })
  )
}

function isInertStatement(
  statement: ts.Statement,
  context: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  if (ts.isEmptyStatement(statement)) return true
  if (ts.isExpressionStatement(statement)) {
    const expression = statement.expression
    if (ts.isStringLiteral(expression)) return true
    if (!ts.isCallExpression(expression) || expression.arguments.length !== 2) return false
    const callee = expression.expression
    const [header, value] = expression.arguments
    return (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'set' &&
      ts.isIdentifier(callee.expression) &&
      checker.getSymbolAtLocation(callee.expression) === context &&
      ts.isStringLiteral(header!) &&
      header.text.toLowerCase() === 'allow' &&
      ts.isStringLiteral(value!) &&
      /^[A-Z]+(?:, *[A-Z]+)*$/.test(value.text)
    )
  }
  if (!ts.isVariableStatement(statement)) return false
  return statement.declarationList.declarations.every(
    (declaration) =>
      ts.isIdentifier(declaration.name) &&
      checker.getSymbolAtLocation(declaration.name) !== context &&
      (!declaration.initializer || ts.isLiteralExpression(declaration.initializer)),
  )
}
