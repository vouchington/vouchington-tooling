import ts from '../contract-schema/typescript-api.mts'
import { httpEmissionKind, contextResponseMethod } from './protocol-http-emission.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { visit } from './response-contract-route-analysis.mts'

export function associateHttpResponse(
  call: ts.CallExpression,
  response: ts.Symbol,
  checker: ts.TypeChecker,
): Map<ts.CallExpression, 'content' | 'none' | 'status'> {
  const handler = enclosingFunction(call)
  const name = handler?.parameters[0]?.name
  const context = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
  if (!handler || !context) throw new Error('HTTP response must bind the handler context')
  const emissions = new Map<ts.CallExpression, 'content' | 'none' | 'status'>()
  visit(handler, (node) => {
    if (!ts.isCallExpression(node) || enclosingFunction(node) !== handler) return
    const kind = httpEmissionKind(node, response, context, checker)
    if (kind) emissions.set(node, kind)
    else if (contextResponseMethod(node.expression, context, checker) === 'setStatus')
      throw new Error('HTTP response has an unrelated or dynamic status emission')
  })
  return emissions
}
