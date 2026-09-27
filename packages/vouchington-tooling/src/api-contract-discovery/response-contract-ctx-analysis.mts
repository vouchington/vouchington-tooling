import ts from '../contract-schema/typescript-api.mts'

export function responseMarker(
  expression: ts.Expression,
): 'apiOpenApiRawResponse' | 'apiResponse' | 'apiNoContent' | undefined {
  if (!ts.isIdentifier(expression)) return undefined
  if (
    expression.text === 'apiOpenApiRawResponse' ||
    expression.text === 'apiResponse' ||
    expression.text === 'apiNoContent'
  )
    return expression.text
  return undefined
}

export function isContextMethod(expression: ts.Expression, method: string): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'ctx' &&
    expression.name.text === method
  )
}

/** Detects the framework's explicit no-body signal independently of the response status. */
export function isContextResponseEmptyCall(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'empty') return false
  return isContextMethod(expression.expression, 'response')
}

/** Detects `ctx.response.buffer(...)`: a raw pass-through body whose shape can't be statically extracted. */
export function isContextResponseBufferCall(expression: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== 'buffer') return false
  return isContextMethod(expression.expression, 'response')
}
