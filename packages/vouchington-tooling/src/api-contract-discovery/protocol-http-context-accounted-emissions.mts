import ts from '../contract-schema/typescript-api.mts'
import { httpHandlerContext } from './protocol-http-context.mts'
import { httpEmissionKind } from './protocol-http-emission.mts'
import { enclosingFunction, protocolMarker, unwrapExpression } from './protocol-marker-analysis.mts'
import { isInErrorBranch } from './response-contract-error-branch.mts'

/** Branded helper dispatch is independently checked by response association in its own scope. */
export function createContextAccountedEmissionProof(
  fn: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
) {
  let responses: Set<ts.Symbol> | undefined
  let context: ts.Symbol | undefined
  return (call: ts.CallExpression, selected: ts.Symbol): boolean => {
    if (!responses) {
      responses = new Set()
      context = httpHandlerContext(fn, checker)
      function visit(node: ts.Node) {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          enclosingFunction(node) === fn
        ) {
          const value = unwrapExpression(node.initializer)
          if (
            ts.isCallExpression(value) &&
            protocolMarker(value.expression, checker) === 'apiOpenApiHttpResponse'
          ) {
            // A recognized marker excludes with-scope names; the bound declaration has a symbol.
            responses!.add(checker.getSymbolAtLocation(node.name)!)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(fn.body!)
    }
    return (
      context === selected &&
      (isInErrorBranch(call, true, checker) ||
        [...responses].some((response) => !!httpEmissionKind(call, response, selected, checker)))
    )
  }
}
