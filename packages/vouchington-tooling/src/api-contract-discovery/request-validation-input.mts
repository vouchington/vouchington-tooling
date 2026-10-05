import ts from '../contract-schema/typescript-api.mts'
import type { Scope } from './request-validation-follow.mts'
import { propertyNameText, resolveObject } from './request-validation-keys.mts'
import { traceValue } from './request-validation-trace.mts'
import { CARRIERS, type Carrier, type ValidatorSite } from './request-validation-types.mts'

export type InputResolution = {
  carriers: ValidatorSite['carriers']
  /** Why the input object is not fully resolved; the carriers listed may then be incomplete. */
  unresolved?: string
  /** Expressions that construct the validated input, whose request reads are not raw reads. */
  nodes: ts.Node[]
}

type Collected = { entries: Map<Carrier, ts.Expression>; unresolved?: string; nodes: ts.Node[] }

/** Applies the object's properties in order, so later properties and spreads win. */
function collect(
  object: ts.ObjectLiteralExpression,
  scope: Scope,
  found: Collected,
  seen: Set<ts.Node>,
) {
  found.nodes.push(object)
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = resolveObject(property.expression, scope.checker, scope.roots)
      if (spread && !seen.has(spread)) collect(spread, scope, found, new Set(seen).add(spread))
      else
        found.unresolved ??= `spread \`${property.expression.getText()}\` is not statically resolvable`
    } else if (property.name && ts.isComputedPropertyName(property.name)) {
      found.unresolved ??= 'a computed property name is not statically resolvable'
    } else if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const carrier = CARRIERS.find((item) => item === propertyNameText(property.name))
      if (carrier)
        found.entries.set(
          carrier,
          ts.isPropertyAssignment(property) ? property.initializer : property.name,
        )
    }
  }
}

/** Resolves the object a validator receives as input, through const objects and spreads. */
export function resolveInput(input: ts.Expression | undefined, scope: Scope): InputResolution {
  const found: Collected = { entries: new Map(), nodes: input ? [input] : [] }
  const object = resolveObject(input, scope.checker, scope.roots)
  if (object) collect(object, scope, found, new Set([object]))
  else if (input) found.unresolved = `input \`${input.getText()}\` is not statically resolvable`
  const carriers = [...found.entries].map(([carrier, value]) => {
    const { origins, unresolved } = traceValue(value, scope)
    return {
      carrier,
      origins: CARRIERS.filter((candidate) => origins.has(candidate)),
      ...(unresolved && { unresolved }),
    }
  })
  return { carriers, ...(found.unresolved && { unresolved: found.unresolved }), nodes: found.nodes }
}
