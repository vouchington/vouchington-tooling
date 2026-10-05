import ts from '../contract-schema/typescript-api.mts'
import { identifierSymbol } from './request-validation-keys.mts'
import type { Carrier } from './request-validation-types.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'

/** What a value is relative to the handler's request context. */
export type RootKind = 'context' | 'request' | 'query' | 'path' | 'header'
/** A value bound to a parameter at a call site, with the request carriers it derives from. */
export type Bound = {
  kind?: RootKind | undefined
  origins: readonly Carrier[]
  unresolved?: string | undefined
  /** The argument expression the call passed, for resolving object literals through it. */
  expression?: ts.Expression | undefined
}
export type RootBindings = ReadonlyMap<ts.Symbol, Bound>

const BODY_READERS = new Set(['json', 'text', 'buffer', 'formData', 'arrayBuffer', 'blob'])

/** The carrier object a named member of a context or request object denotes. */
export function memberKind(base: RootKind | undefined, name: string): RootKind | undefined {
  if (base === 'context' && (name === 'request' || name === 'req')) return 'request'
  if ((base === 'context' || base === 'request') && name === 'query') return 'query'
  if (base === 'context' && name === 'params') return 'path'
  if ((base === 'context' || base === 'request') && (name === 'headers' || name === 'header'))
    return 'header'
  return undefined
}

/** The const initializer an identifier aliases, with the destructured key when it is a member. */
function aliasSource(
  symbol: ts.Symbol,
): { initializer: ts.Expression; key?: string | null } | undefined {
  for (const declaration of symbol.declarations ?? []) {
    const owner = ts.isBindingElement(declaration) ? declaration.parent.parent : declaration
    if (
      !ts.isVariableDeclaration(owner) ||
      !owner.initializer ||
      !(ts.getCombinedNodeFlags(owner) & ts.NodeFlags.Const)
    )
      continue
    if (!ts.isBindingElement(declaration)) return { initializer: owner.initializer }
    const name = declaration.propertyName ?? declaration.name
    const member = ts.isObjectBindingPattern(declaration.parent) && !declaration.dotDotDotToken
    const named = ts.isIdentifier(name) || ts.isStringLiteral(name)
    return { initializer: owner.initializer, key: member && named ? name.text : null }
  }
  return undefined
}

export function rootKind(
  expression: ts.Expression,
  roots: RootBindings,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): RootKind | undefined {
  const value = unwrapTransparentExpression(expression)
  if (ts.isPropertyAccessExpression(value))
    return memberKind(rootKind(value.expression, roots, checker, seen), value.name.text)
  if (ts.isElementAccessExpression(value))
    return ts.isStringLiteralLike(value.argumentExpression)
      ? memberKind(rootKind(value.expression, roots, checker, seen), value.argumentExpression.text)
      : undefined
  if (!ts.isIdentifier(value)) return undefined
  const symbol = identifierSymbol(value, checker)
  if (!symbol || seen.has(symbol)) return undefined
  const bound = roots.get(symbol)
  if (bound) return bound.kind
  const alias = aliasSource(symbol)
  if (!alias) return undefined
  const base = rootKind(alias.initializer, roots, checker, new Set(seen).add(symbol))
  if (alias.key === undefined) return base
  return alias.key === null ? undefined : memberKind(base, alias.key)
}

/** `X.request.json()` and its siblings, where X is the request context. */
export function isBodyRead(
  call: ts.CallExpression,
  roots: RootBindings,
  checker: ts.TypeChecker,
): boolean {
  const callee = unwrapTransparentExpression(call.expression)
  return (
    ts.isPropertyAccessExpression(callee) &&
    BODY_READERS.has(callee.name.text) &&
    rootKind(callee.expression, roots, checker) === 'request'
  )
}

/** `ctx.get(name)`. */
export function isHeaderGet(
  call: ts.CallExpression,
  roots: RootBindings,
  checker: ts.TypeChecker,
): boolean {
  const callee = unwrapTransparentExpression(call.expression)
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'get' &&
    rootKind(callee.expression, roots, checker) === 'context'
  )
}
