import ts from '../contract-schema/typescript-api.mts'

export const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export function isInlineRouteHandler(node: ts.Node): boolean {
  if (
    (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) ||
    !ts.isCallExpression(node.parent)
  )
    return false
  const method = propertyName(node.parent.expression)?.toUpperCase()
  return (
    !!method && HTTP_METHODS.has(method) && !!routeTemplateFromExpression(node.parent.expression)
  )
}

export function routeTemplateFromExpression(expression: ts.Expression): string | undefined {
  if (!ts.isPropertyAccessExpression(expression)) return undefined
  return findRouteCall(expression.expression)
}

function findRouteCall(expression: ts.Expression): string | undefined {
  if (!ts.isCallExpression(expression)) return undefined
  if (!ts.isPropertyAccessExpression(expression.expression)) return undefined
  if (expression.expression.name.text === 'route') {
    const route = expression.arguments[0]
    return route && ts.isStringLiteral(route) ? route.text : undefined
  }
  return findRouteCall(expression.expression.expression)
}

export function propertyName(expression: ts.Expression): string | undefined {
  return ts.isPropertyAccessExpression(expression) ? expression.name.text : undefined
}

export function unwrapTransparentExpression(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  )
    expression = expression.expression
  return expression
}

export function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node)
  node.forEachChild((child) => visit(child, callback))
}
