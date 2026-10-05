import ts from '../contract-schema/typescript-api.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'
import { resolveSymbol } from './response-contract-symbols.mts'

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

/** Resolves string literals, const identifiers and bound parameters; anything else is `undefined`. */
export function resolveKey(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
  bindings: KeyBindings,
  seen = new Set<ts.Node>(),
): string | undefined {
  if (!expression) return undefined
  const value = unwrapTransparentExpression(expression)
  if (ts.isStringLiteralLike(value)) return value.text
  if (!ts.isIdentifier(value)) return undefined
  const symbol = identifierSymbol(value, checker)
  const bound = symbol && bindings.get(symbol)
  if (bound !== undefined) return bound
  const initializer = constInitializer(value, checker)
  if (!initializer || seen.has(initializer)) return undefined
  return resolveKey(initializer, checker, bindings, new Set(seen).add(initializer))
}

/** The object literal an expression denotes, through const identifiers. */
export function resolveObject(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
  seen = new Set<ts.Node>(),
): ts.ObjectLiteralExpression | undefined {
  if (!expression || seen.has(expression)) return undefined
  const value = unwrapTransparentExpression(expression)
  if (ts.isObjectLiteralExpression(value)) return value
  const initializer = ts.isIdentifier(value) ? constInitializer(value, checker) : undefined
  return resolveObject(initializer, checker, new Set(seen).add(expression))
}

const ABSENT = Symbol('absent')
type Lookup = string | undefined | typeof ABSENT

function lookupProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  checker: ts.TypeChecker,
  bindings: KeyBindings,
  seen: Set<ts.Node>,
): Lookup {
  for (const property of object.properties.toReversed()) {
    if (ts.isSpreadAssignment(property)) {
      const spread = resolveObject(property.expression, checker)
      const found =
        spread && !seen.has(spread)
          ? lookupProperty(spread, name, checker, bindings, new Set(seen).add(spread))
          : undefined
      if (found !== ABSENT) return found
    } else if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyNameText(property.name) === name
    )
      return resolveKey(
        ts.isPropertyAssignment(property) ? property.initializer : property.name,
        checker,
        bindings,
      )
  }
  return ABSENT
}

/** Resolves a string property of an options object, including from spread const objects. */
export function resolveOptionString(
  expression: ts.Expression | undefined,
  name: string,
  checker: ts.TypeChecker,
  bindings: KeyBindings,
): string | undefined {
  const object = resolveObject(expression, checker)
  if (!object) return undefined
  const found = lookupProperty(object, name, checker, bindings, new Set([object]))
  return found === ABSENT ? undefined : found
}
