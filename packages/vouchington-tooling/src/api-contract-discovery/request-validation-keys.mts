import ts from '../contract-schema/typescript-api.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'
import { resolveSymbol } from './response-contract-symbols.mts'
import { reachingWrites } from './request-validation-trace-helpers.mts'

/** Static string values bound to helper or factory parameters. */
export type KeyBindings = ReadonlyMap<ts.Symbol, string>

const isConst = (declaration: ts.VariableDeclaration) =>
  !!(ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const)

/** A property name written as an identifier or string literal; computed names are `undefined`. */
export const propertyNameText = (name: ts.PropertyName | undefined) =>
  name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined

/** The variable symbol an identifier reads, including a shorthand property's value. */
export function identifierSymbol(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  return ts.isShorthandPropertyAssignment(identifier.parent)
    ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : checker.getSymbolAtLocation(identifier)
}

/** The initializer of the const variable an identifier names, through imports and aliases. */
function constInitializer(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
): ts.Expression | undefined {
  const symbol = identifierSymbol(identifier, checker)
  const declaration =
    symbol && resolveSymbol(symbol, checker).declarations?.find(ts.isVariableDeclaration)
  return declaration?.initializer && isConst(declaration) ? declaration.initializer : undefined
}

/** Folds a template literal whose every substitution resolves to a static string. */
function resolveTemplate(
  template: ts.TemplateExpression,
  checker: ts.TypeChecker,
  bindings: KeyBindings,
  seen: Set<ts.Node>,
): string | undefined {
  let text = template.head.text
  for (const span of template.templateSpans) {
    const part = resolveKey(span.expression, checker, bindings, seen)
    if (part === undefined) return undefined
    text += part + span.literal.text
  }
  return text
}

/** Resolves string literals, templates, const identifiers and bound parameters, else `undefined`. */
export function resolveKey(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
  bindings: KeyBindings,
  seen = new Set<ts.Node>(),
): string | undefined {
  if (!expression) return undefined
  const value = unwrapTransparentExpression(expression)
  if (ts.isStringLiteralLike(value)) return value.text
  if (ts.isTemplateExpression(value)) return resolveTemplate(value, checker, bindings, seen)
  if (!ts.isIdentifier(value)) return undefined
  const symbol = identifierSymbol(value, checker)
  const bound = symbol && bindings.get(symbol)
  if (bound !== undefined) return bound
  const initializer = constInitializer(value, checker)
  if (!initializer || seen.has(initializer)) return undefined
  return resolveKey(initializer, checker, bindings, new Set(seen).add(initializer))
}

/** Call-site bindings of parameters; an `expression` is the argument the call passes. */
export type ParamBindings = ReadonlyMap<ts.Symbol, { expression?: ts.Expression | undefined }>
const NO_PARAMS: ParamBindings = new Map()

/** The argument bound to a parameter, unless the helper reassigns the parameter first. */
function boundArgument(identifier: ts.Identifier, checker: ts.TypeChecker, params: ParamBindings) {
  const symbol = identifierSymbol(identifier, checker)
  const expression = symbol && params.get(symbol)?.expression
  if (!symbol || !expression) return undefined
  return reachingWrites(identifier, symbol, checker).writes.length > 0 ? undefined : expression
}

/** The object literal an expression denotes, through const identifiers and bound parameters. */
export function resolveObject(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
  params: ParamBindings = NO_PARAMS,
  seen = new Set<ts.Node>(),
): ts.ObjectLiteralExpression | undefined {
  if (!expression || seen.has(expression)) return undefined
  const value = unwrapTransparentExpression(expression)
  if (ts.isObjectLiteralExpression(value)) return value
  if (!ts.isIdentifier(value)) return undefined
  const next = boundArgument(value, checker, params) ?? constInitializer(value, checker)
  return resolveObject(next, checker, params, new Set(seen).add(expression))
}

export const ABSENT = Symbol('absent')
/** `undefined` means the property cannot be statically resolved. */
type Found = ts.Expression | undefined | typeof ABSENT

/** The value expression a property ends with, applying properties and spreads in order. */
export function findProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  checker: ts.TypeChecker,
  params: ParamBindings,
  seen: Set<ts.Node>,
): Found {
  for (const property of object.properties.toReversed()) {
    if (ts.isSpreadAssignment(property)) {
      const spread = resolveObject(property.expression, checker, params)
      const found =
        spread && !seen.has(spread)
          ? findProperty(spread, name, checker, params, new Set(seen).add(spread))
          : undefined
      if (found !== ABSENT) return found
    } else if (ts.isComputedPropertyName(property.name)) {
      return undefined
    } else if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyNameText(property.name) === name
    )
      return ts.isPropertyAssignment(property) ? property.initializer : property.name
  }
  return ABSENT
}

/** Resolves a string property of an options object, including from spread const objects. */
export function resolveOptionString(
  expression: ts.Expression | undefined,
  name: string,
  checker: ts.TypeChecker,
  bindings: KeyBindings,
  params: ParamBindings = NO_PARAMS,
): string | undefined {
  const object = resolveObject(expression, checker, params)
  if (!object) return undefined
  const found = findProperty(object, name, checker, params, new Set([object]))
  return found === ABSENT ? undefined : resolveKey(found, checker, bindings)
}
