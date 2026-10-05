import ts from '../contract-schema/typescript-api.mts'
import { resolveKey, type KeyBindings } from './request-validation-keys.mts'
import {
  isBodyRead,
  isHeaderGet,
  rootKind,
  type RootBindings,
} from './request-validation-origin.mts'
import type { Carrier } from './request-validation-types.mts'

export type RawRead = { carrier: Carrier; key: string | null }

type Scope = { checker: ts.TypeChecker; roots: RootBindings; keys: KeyBindings }

const carrierRoot = (node: ts.Expression, scope: Scope): Carrier | undefined => {
  const kind = rootKind(node, scope.roots, scope.checker)
  return kind === 'query' || kind === 'path' || kind === 'header' ? kind : undefined
}

/** The raw request reads made by exactly this node, not by its children. */
export function rawReadsAt(node: ts.Node, scope: Scope): RawRead[] {
  const keyOf = (expression: ts.Expression | undefined) =>
    resolveKey(expression, scope.checker, scope.keys) ?? null
  if (ts.isCallExpression(node)) {
    if (isBodyRead(node, scope.roots, scope.checker)) return [{ carrier: 'body', key: null }]
    if (isHeaderGet(node, scope.roots, scope.checker))
      return [{ carrier: 'header', key: keyOf(node.arguments[0]) }]
    return []
  }
  if (ts.isPropertyAccessExpression(node)) {
    const carrier = carrierRoot(node.expression, scope)
    return carrier ? [{ carrier, key: node.name.text }] : []
  }
  if (ts.isElementAccessExpression(node)) {
    const carrier = carrierRoot(node.expression, scope)
    return carrier ? [{ carrier, key: keyOf(node.argumentExpression) }] : []
  }
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
    const carrier = carrierRoot(node.initializer, scope)
    if (!carrier) return []
    return node.name.elements.map((element) => {
      const name = element.propertyName ?? element.name
      const named = ts.isIdentifier(name) || ts.isStringLiteral(name)
      return { carrier, key: named && !element.dotDotDotToken ? name.text : null }
    })
  }
  return []
}
