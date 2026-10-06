import { isFunctionLike, isNode, propertyName } from './source-ast.mts'
import { canonicalCallNames } from './source-helpers.mts'

type Node = import('./source-ast.mts').UnknownNode
type BoundaryBinding = { declaredAt: number; declaration: Node; name: string }

export function isShadowedAtUse(binding: BoundaryBinding, ancestors: Node[]): boolean {
  return ancestors.some((ancestor) => {
    if (!isFunctionLike(ancestor) || !Array.isArray(ancestor.params)) return false
    if (
      binding.declaration.range[0] >= ancestor.range[0] &&
      binding.declaration.range[1] <= ancestor.range[1]
    ) {
      return false
    }
    return ancestor.params.some((param) => isNode(param) && propertyName(param) === binding.name)
  })
}
export function isThenBoundaryParameter(
  receiver: string,
  ancestors: Node[],
  imported: Set<string>,
): boolean {
  return ancestors.some((ancestor) => {
    if (!isFunctionLike(ancestor) || !Array.isArray(ancestor.params)) return false
    if (!ancestor.params.some((param) => isNode(param) && propertyName(param) === receiver))
      return false
    const parent = ancestors[ancestors.indexOf(ancestor) - 1]
    if (!parent || parent.type !== 'CallExpression' || !isNode(parent.callee)) return false
    if (
      parent.callee.type !== 'MemberExpression' ||
      !isNode(parent.callee.object) ||
      !isNode(parent.callee.property) ||
      propertyName(parent.callee.property) !== 'then'
    ) {
      return false
    }
    return canonicalCallNames(parent.callee.object, imported).length > 0
  })
}
