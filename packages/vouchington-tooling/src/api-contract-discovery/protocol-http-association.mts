import ts from '../contract-schema/typescript-api.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { httpEmissionKind, contextResponseMethod } from './protocol-http-emission.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { unsupportedContextAlias } from './protocol-context-alias.mts'
import { visit } from './response-contract-route-analysis.mts'

export function associateHttpResponse(
  call: ts.CallExpression,
  response: ts.Symbol,
  checker: ts.TypeChecker,
): Map<ts.CallExpression, 'content' | 'none' | 'status'> {
  const handler = enclosingFunction(call)
  const name = handler && runtimeParameters(handler)[0]?.name
  const context = name && ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
  if (!handler || !context) throw new Error('HTTP response must bind the handler context')
  const emissions = new Map<ts.CallExpression, 'content' | 'none' | 'status'>()
  visit(handler, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      enclosingFunction(node) === handler &&
      unsupportedContextAlias(node, context, checker)
    )
      throw new Error('HTTP response context has an unsupported mutable or destructured alias')
    if (
      !ts.isCallExpression(node) ||
      enclosingFunction(node) !== handler ||
      !potentiallyExecuted(node)
    )
      return
    const kind = httpEmissionKind(node, response, context, checker)
    if (kind) emissions.set(node, kind)
    else if (
      ['setStatus', 'pipeline', 'json', 'response.buffer', 'response.empty'].includes(
        contextResponseMethod(node.expression, context, checker) ?? '',
      )
    )
      throw new Error('HTTP response has an unrelated status or body emission')
  })
  return emissions
}
