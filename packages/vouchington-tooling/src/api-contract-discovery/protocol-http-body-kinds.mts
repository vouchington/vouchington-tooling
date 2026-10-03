import ts from '../contract-schema/typescript-api.mts'
import { propertyType, stringLiterals, typeVariants } from './protocol-marker-analysis.mts'

/** Checks complete wire body kinds without extracting unselected payload schemas. */
export function extractHttpBodyKinds(
  type: ts.Type,
  checker: ts.TypeChecker,
): ReadonlySet<'content' | 'none'> {
  const carrier = propertyType(type, 'apiHttpResponseVariants', checker)
  const kinds = new Set<'content' | 'none'>()
  for (const variant of typeVariants(carrier)) {
    if (variant.flags & ts.TypeFlags.Undefined) continue
    const names = stringLiterals(propertyType(variant, 'bodyKind', checker))
    if (names.length !== 1)
      throw new Error('HTTP response requires one concrete body kind per variant')
    const kind = names[0]
    if (kind !== 'content' && kind !== 'none') throw new Error('HTTP response body kind is invalid')
    kinds.add(kind)
  }
  return kinds
}
