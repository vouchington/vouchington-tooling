import ts from '../contract-schema/typescript-api.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'

/** Literal bracket access is equivalent to property access for response methods. */
export function contextResponseMethod(
  expression: ts.Expression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  allowMutable = false,
): string | undefined {
  const access = methodAccess(expression)
  if (!access) return undefined
  const receiver = httpContextReceiver(access.receiver, checker)
  if (receiver?.root !== context || (receiver.mutableAlias && !allowMutable)) return undefined
  if (receiver.path.length === 0) return access.name
  if (receiver.path.length === 1 && receiver.path[0] === 'response')
    return `response.${access.name}`
  return undefined
}

export function methodAccess(expression: ts.Expression) {
  if (ts.isPropertyAccessExpression(expression))
    return { receiver: expression.expression, name: expression.name.text }
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression))
    return { receiver: expression.expression, name: expression.argumentExpression.text }
  return undefined
}

/** Uses the existing canonical receiver plus literal response-property access. */
export function httpContextReceiver(expression: ts.Expression, checker: ts.TypeChecker) {
  const receiver = expressionReceiver(expression, checker)
  if (receiver) return receiver
  const access = methodAccess(expression)
  if (!access || access.name !== 'response') return undefined
  const parent = expressionReceiver(access.receiver, checker)
  return parent && { ...parent, path: [...parent.path, 'response'] }
}
