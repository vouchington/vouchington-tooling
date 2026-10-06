import ts from '../contract-schema/typescript-api.mts'
import { httpContextContainerMembers } from './protocol-http-context-container-members.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'

/** Evaluated static class members expose selected capabilities to an opaque constructor consumer. */
export function selectedStaticSseClassCapability(
  value: ts.Expression,
  selected: (value: ts.Expression) => boolean,
  captured?: (fn: ts.SignatureDeclaration) => boolean,
): boolean {
  if (!ts.isClassExpression(value)) return false
  function contains(node: ts.Node): boolean {
    if (!potentiallyExecuted(node)) return false
    if (ts.isFunctionLike(node)) return captured?.(node) ?? false
    if (ts.isVariableDeclaration(node)) return !!node.initializer && contains(node.initializer)
    const actual =
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node
        ? node.expression
        : node
    if (ts.isObjectLiteralExpression(actual) || ts.isArrayLiteralExpression(actual))
      return selected(actual)
    if (ts.isExpression(actual) && selected(actual)) return true
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return false
    return ts.forEachChild(node, contains) === true
  }
  return httpContextContainerMembers(value)!.some(contains)
}
