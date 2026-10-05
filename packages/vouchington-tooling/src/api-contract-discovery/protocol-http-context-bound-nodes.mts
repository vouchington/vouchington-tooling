import type ts from '../contract-schema/typescript-api.mts'
import { opaqueHttpContextConstruction } from './protocol-http-context.mts'
import { mutatesHttpResponseMethod } from './protocol-http-method-mutations.mts'

/** Source mutations and constructor escapes invalidate the same caller-bound context proof. */
export function unsupportedBoundContextNode(
  node: ts.Node,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  handler: ts.FunctionLikeDeclaration,
): boolean {
  return (
    mutatesHttpResponseMethod(node, context, checker, handler) ||
    opaqueHttpContextConstruction(node, checker, context, handler)
  )
}
