import ts from './typescript-api.mts'

import { canonicalContractSchemaNode } from '../openapi-document/contract-schema-canonical.mts'
import type { ContractSchemaNode } from '../openapi-document/contract-schema-types.mts'

export function namedObjectDefinition(type: ts.Type, checker: ts.TypeChecker): string | undefined {
  const symbol = type.aliasSymbol ?? type.getSymbol()
  if (!symbol || symbol.name === '__type' || symbol.name === '__object') return undefined
  if (!type.aliasSymbol && !isDeclaredTypeSymbol(symbol)) return undefined
  const typeArguments = type.aliasTypeArguments ?? (type as ts.TypeReference).typeArguments
  if (!typeArguments?.length) return symbol.name
  return `${symbol.name}<${typeArguments.map((argument) => typeIdentity(argument, checker)).join(',')}>`
}

/**
 * A plain (non-alias) symbol only identifies a genuine named type when it comes from an actual
 * type-level declaration (interface/class/enum). The checker also attaches a destructuring
 * variable's own symbol to the anonymous object type it synthesizes for a rest-binding pattern
 * (`const { a, ...rest } = x`) — e.g. `rows.map(({ a, ...row }) => row)` names its per-call-site
 * anonymous shape "row" purely from the local variable, not a real type. Treating that as a
 * definition name falsely unifies (or falsely collides) unrelated shapes across call sites that
 * happen to reuse the same rest-variable name.
 */
function isDeclaredTypeSymbol(symbol: ts.Symbol): boolean {
  return Boolean(
    symbol.declarations?.some(
      (declaration) =>
        ts.isInterfaceDeclaration(declaration) ||
        ts.isClassDeclaration(declaration) ||
        ts.isEnumDeclaration(declaration),
    ),
  )
}

/**
 * Builds a name-suffix identity for one generic type argument. Recurses into the argument's own
 * type arguments (e.g. `Array<Widget>`) so two different generics instantiated with the same outer
 * shape but different nested element types don't collapse onto the same suffix. Anonymous element
 * types (inline object literals, which have no symbol) fall back to a full structural stringify —
 * without it, `Record<string, Array<{a}>>` and `Record<string, Array<{b}>>` would both identify as
 * bare `Array` and sanitize to the same component name despite differing shapes.
 *
 * Literal type arguments (e.g. the `'topic'` in `PaginatedResult<'topic'>`) must keep their literal
 * value rather than collapsing to the base primitive name — otherwise `PaginatedResult<'topic'>`
 * and `PaginatedResult<'notification'>` both identify as `PaginatedResult<string>` and collide.
 */
function typeIdentity(type: ts.Type, checker: ts.TypeChecker): string {
  if (type.flags & ts.TypeFlags.StringLiteral) return String((type as ts.StringLiteralType).value)
  if (type.flags & ts.TypeFlags.NumberLiteral) return String((type as ts.NumberLiteralType).value)
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return String((type as ts.Type & { intrinsicName: string }).intrinsicName === 'true')
  }
  if (type.flags & ts.TypeFlags.StringLike) return 'string'
  if (type.flags & ts.TypeFlags.NumberLike) return 'number'
  if (type.flags & ts.TypeFlags.BooleanLike) return 'boolean'
  if (type.flags & ts.TypeFlags.Null) return 'null'
  const symbol = type.aliasSymbol ?? type.getSymbol()
  if (symbol && symbol.name !== '__type' && symbol.name !== '__object') {
    const typeArguments = type.aliasTypeArguments ?? (type as ts.TypeReference).typeArguments
    return typeArguments?.length
      ? `${symbol.name}<${typeArguments.map((argument) => typeIdentity(argument, checker)).join(',')}>`
      : symbol.name
  }
  return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation)
}

export function distinctNodes(nodes: ContractSchemaNode[]): ContractSchemaNode[] {
  const nodesByCanonicalSchema = new Map<string, ContractSchemaNode>()

  for (const node of nodes) {
    const canonicalSchema = canonicalContractSchemaNode(node)
    if (!nodesByCanonicalSchema.has(canonicalSchema)) {
      nodesByCanonicalSchema.set(canonicalSchema, node)
    }
  }

  return [...nodesByCanonicalSchema]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, node]) => node)
}

export function assertNotClass(type: ts.Type, checker: ts.TypeChecker): void {
  const symbol = type.getSymbol()
  if (symbol?.declarations?.some(ts.isClassDeclaration)) {
    throw unsupportedType(type, checker, 'class instances are not supported')
  }
}

export function jsonPromiseType(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  const symbol = type.aliasSymbol ?? type.getSymbol()
  if (symbol?.name !== 'Promise' && symbol?.name !== 'PromiseLike') return undefined
  return checker.getTypeArguments(type as ts.TypeReference)[0]
}

export function jsonSerializedType(type: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
  const toJSON = checker.getPropertyOfType(type, 'toJSON')
  if (!toJSON) return undefined
  const declaration = toJSON.valueDeclaration
  /* v8 ignore next */
  if (!declaration) return undefined
  const toJSONType = checker.getTypeOfSymbolAtLocation(toJSON, declaration)
  const signature = checker.getSignaturesOfType(toJSONType, ts.SignatureKind.Call)[0]
  /* v8 ignore next */
  return signature ? checker.getReturnTypeOfSignature(signature) : undefined
}

export function unsupportedType(type: ts.Type, checker: ts.TypeChecker, reason: string): Error {
  return new Error(`Unsupported response contract type "${checker.typeToString(type)}": ${reason}`)
}

export function compareSymbols(left: ts.Symbol, right: ts.Symbol): number {
  return left.name.localeCompare(right.name)
}
