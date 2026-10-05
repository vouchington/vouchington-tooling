import ts from '../contract-schema/typescript-api.mts'
import type { Scope } from './request-validation-follow.mts'
import { ABSENT, findProperty, stableConstInitializer } from './request-validation-keys.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

/** The property name or array position a destructured binding selects, when it is static. */
export function bindingKey(element: ts.BindingElement): string | number | undefined {
  if (element.dotDotDotToken) return undefined
  if (ts.isArrayBindingPattern(element.parent)) return element.parent.elements.indexOf(element)
  const name = element.propertyName ?? element.name
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
}

/**
 * The expression a literal (or a const naming one) holds at a property or position: `null` when
 * nothing is there, `undefined` when it cannot be resolved statically.
 */
export function literalMember(
  node: ts.Node,
  key: string | number,
  scope: Scope,
  seen = new Set<ts.Node>(),
): ts.Expression | null | undefined {
  const value = unwrapTransparentExpression(node as ts.Expression)
  if (seen.has(value)) return undefined
  if (ts.isIdentifier(value)) {
    const initializer = stableConstInitializer(value, scope.checker)
    return initializer && literalMember(initializer, key, scope, new Set(seen).add(value))
  }
  if (typeof key === 'number') {
    if (!ts.isArrayLiteralExpression(value)) return undefined
    if (value.elements.slice(0, key + 1).some(ts.isSpreadElement)) return undefined
    return value.elements[key] ?? null
  }
  if (!ts.isObjectLiteralExpression(value)) return undefined
  const found = findProperty(value, key, scope.checker, scope.roots, new Set([value]))
  return found === ABSENT ? null : found
}
