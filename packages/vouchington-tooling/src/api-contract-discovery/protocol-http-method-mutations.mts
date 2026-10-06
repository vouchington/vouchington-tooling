import ts from '../contract-schema/typescript-api.mts'
import { contextResponseMethod } from './protocol-http-context.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { contextMutationTargets } from './protocol-http-context-write-targets.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'

const responseMethods = new Set([
  'setStatus',
  'pipeline',
  'json',
  'response',
  'response.buffer',
  'response.empty',
  'response.xml',
])

/** A feasible write through a canonical context alias invalidates response dispatch evidence. */
export function mutatesHttpResponseMethod(
  node: ts.Node,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  boundHandler?: ts.Node,
): boolean {
  if (
    !contextMutationTargets(node).some((target) =>
      responseMethods.has(
        contextResponseMethod(unwrapExpression(target), context, checker, true) ?? '',
      ),
    )
  )
    return false
  return (
    executableProtocolPath(node, checker, boundHandler) || opaqueProtocolCallbackPath(node, checker)
  )
}
