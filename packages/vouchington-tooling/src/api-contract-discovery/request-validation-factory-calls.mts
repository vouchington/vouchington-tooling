import ts from '../contract-schema/typescript-api.mts'
import { calleeSymbol, findConfig } from './request-validation-match.mts'
import type { FactoryConfig } from './request-validation-types.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

/**
 * The configured factory call that built the handler a call invokes: the callee resolves to a
 * `const` binding initialized by that factory call, as in `const handler = createHandler({...})`
 * followed by `handler(ctx)`.
 */
export function calledFactory(
  call: ts.CallExpression,
  factories: readonly FactoryConfig[],
  checker: ts.TypeChecker,
): { call: ts.CallExpression; config: FactoryConfig } | undefined {
  for (const declaration of calleeSymbol(call.expression, checker)?.declarations ?? []) {
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) continue
    if (!(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const)) continue
    const built = unwrapTransparentExpression(declaration.initializer)
    if (!ts.isCallExpression(built)) continue
    const config = findConfig(built.expression, factories, checker)
    if (config) return { call: built, config }
  }
  return undefined
}
