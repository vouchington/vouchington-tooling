import ts from '../contract-schema/typescript-api.mts'

export function protocolMarker(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): 'apiSseFrame' | 'apiOpenApiHttpResponse' | undefined {
  const symbol = checker.getSymbolAtLocation(expression)
  const resolved =
    symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
  const name = resolved?.name
  return name === 'apiSseFrame' || name === 'apiOpenApiHttpResponse' ? name : undefined
}

export function propertyType(type: ts.Type, name: string, checker: ts.TypeChecker): ts.Type {
  const property = checker.getPropertyOfType(type, name)
  const declaration = property?.valueDeclaration ?? property?.declarations?.[0]
  if (!property || !declaration) throw new Error(`Protocol contract requires ${name}`)
  return checker.getTypeOfSymbolAtLocation(property, declaration)
}

export function typeVariants(type: ts.Type): readonly ts.Type[] {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never))
    throw new Error('Protocol contract requires concrete variants')
  return type.isUnion() ? type.types : [type]
}

export function stringLiterals(type: ts.Type): string[] {
  return typeVariants(type).map((variant) => {
    if (!(variant.flags & ts.TypeFlags.StringLiteral))
      throw new Error('Protocol contract requires literal names and media types')
    const value = (variant as ts.StringLiteralType).value
    if (!value || /[\r\n]/.test(value))
      throw new Error('Protocol contract requires nonempty single-line names')
    return value
  })
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isAwaitExpression(expression)
  )
    return unwrapExpression(expression.expression)
  return expression
}

export function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current = node.parent
  while (current) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current)
    )
      return current
    current = current.parent
  }
  return undefined
}
