import ts from '../contract-schema/typescript-api.mts'
import type { CallbackBindings, CallbackValue } from './protocol-callback-values.mts'
import type { ContextValues } from './protocol-http-context-value-types.mts'
type ContextProperty = { value: CallbackValue | null; present: boolean }
type Properties = readonly ContextProperty[] | undefined
export function contextProperty(
  value: CallbackValue,
  name: string,
  seen: Set<ts.Node>,
  resolver: {
    checker: ts.TypeChecker
    resolve: (node: ts.Node, env: CallbackBindings, seen: Set<ts.Node>) => ContextValues
    declaration: (target: ts.Symbol, env: CallbackBindings, seen: Set<ts.Node>) => ContextValues
  },
  last?: number,
): Properties {
  const { resolve, declaration, checker } = resolver
  if (!ts.isObjectLiteralExpression(value.node)) return undefined
  for (let index = last ?? value.node.properties.length - 1; index >= 0; index--) {
    const member = value.node.properties[index]!
    if (ts.isSpreadAssignment(member)) {
      const spreads = resolve(member.expression, value.env, new Set(seen))
      if (!spreads) return undefined
      const rows = spreads.flatMap((spread) => {
        const properties = spread
          ? contextProperty(spread, name, new Set(seen), resolver)
          : [{ value: null, present: false }]
        return (
          properties?.flatMap<ContextProperty | undefined>((row) =>
            row.present
              ? [row]
              : (contextProperty(value, name, new Set(seen), resolver, index - 1) ?? [undefined]),
          ) ?? [undefined]
        )
      })
      return rows.some((row) => row === undefined) ? undefined : (rows as NonNullable<Properties>)
    }
    const key = member.name
    if (!key || !(ts.isIdentifier(key) || ts.isStringLiteral(key))) return undefined
    if (key.text !== name) continue
    const values = ts.isPropertyAssignment(member)
      ? resolve(member.initializer, value.env, seen)
      : ts.isShorthandPropertyAssignment(member)
        ? (() => {
            const target = checker.getShorthandAssignmentValueSymbol(member)
            return target ? declaration(target, value.env, seen) : undefined
          })()
        : ts.isMethodDeclaration(member)
          ? [{ node: member, env: value.env }]
          : undefined
    return values?.map((value) => ({ value, present: true }))
  }
  if (
    value.node.properties.some(
      (member) =>
        member.name &&
        (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
        member.name.text === '__proto__',
    )
  )
    return undefined
  return [{ value: null, present: false }]
}
