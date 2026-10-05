import ts from '../contract-schema/typescript-api.mts'
import { resolveKey, type KeyBindings } from './request-validation-keys.mts'
import {
  isBodyRead,
  isHeaderGet,
  rootKind,
  type RootBindings,
} from './request-validation-origin.mts'
import type { CarrierRead } from './request-validation-types.mts'

export type RawRead = Omit<CarrierRead, 'source'>

type Scope = { checker: ts.TypeChecker; roots: RootBindings; keys: KeyBindings }

type Named = { name?: ts.Node; propertyName?: ts.Node }

const carrierRoot = (node: ts.Expression, scope: Scope) => {
  const kind = rootKind(node, scope.roots, scope.checker)
  return kind === 'query' || kind === 'path' || kind === 'header' ? kind : undefined
}

const isTransparent = (node: ts.Node) =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node)

/** True when an identifier sits where it declares or names a property rather than reads a value. */
function namesSomething(node: ts.Node): boolean {
  const { name, propertyName } = node.parent as unknown as Named
  return (name === node && !ts.isShorthandPropertyAssignment(node.parent)) || propertyName === node
}

/** True when the carrier expression is consumed as a value, not indexed, aliased or destructured. */
function consumedAsValue(node: ts.Expression): boolean {
  if (ts.isIdentifier(node) && namesSomething(node)) return false
  let outer: ts.Node = node
  while (isTransparent(outer.parent)) outer = outer.parent
  const parent = outer.parent
  if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
    return parent.expression !== outer
  if (ts.isVariableDeclaration(parent) && parent.initializer === outer)
    return !(
      ts.isObjectBindingPattern(parent.name) ||
      (ts.isIdentifier(parent.name) && !!(ts.getCombinedNodeFlags(parent) & ts.NodeFlags.Const))
    )
  return !ts.isExpressionStatement(parent)
}

/** A whole-carrier read: the carrier object itself used as a value, as in `consume(ctx.query)`. */
function wholeRead(node: ts.Node, scope: Scope): RawRead[] {
  if (!ts.isExpression(node) || isTransparent(node)) return []
  const carrier = carrierRoot(node, scope)
  return carrier && consumedAsValue(node) ? [{ carrier, key: null, access: 'whole' }] : []
}

function destructuredRead(element: ts.BindingElement, carrier: RawRead['carrier']): RawRead {
  const name = element.propertyName ?? element.name
  if (element.dotDotDotToken) return { carrier, key: null, access: 'whole' }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name))
    return { carrier, key: name.text, access: 'key' }
  return { carrier, key: null, access: 'computed' }
}

/** The raw request reads made by exactly this node, not by its children. */
export function rawReadsAt(node: ts.Node, scope: Scope): RawRead[] {
  const keyed = (carrier: RawRead['carrier'], expression: ts.Expression | undefined): RawRead => {
    const key = resolveKey(expression, scope.checker, scope.keys) ?? null
    return { carrier, key, access: key === null ? 'computed' : 'key' }
  }
  if (ts.isCallExpression(node)) {
    if (isBodyRead(node, scope.roots, scope.checker))
      return [{ carrier: 'body', key: null, access: 'whole' }]
    return isHeaderGet(node, scope.roots, scope.checker) ? [keyed('header', node.arguments[0])] : []
  }
  if (ts.isPropertyAccessExpression(node)) {
    const carrier = carrierRoot(node.expression, scope)
    if (carrier) return [{ carrier, key: node.name.text, access: 'key' }]
  }
  if (ts.isElementAccessExpression(node)) {
    const carrier = carrierRoot(node.expression, scope)
    if (carrier) return [keyed(carrier, node.argumentExpression)]
  }
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
    const carrier = carrierRoot(node.initializer, scope)
    return carrier ? node.name.elements.map((element) => destructuredRead(element, carrier)) : []
  }
  return wholeRead(node, scope)
}
