import {
  findVariable,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'

export function isUnshadowedPromiseResolve(context: RuleContextLike, value: NodeLike): boolean {
  const current = unwrap(value)
  if (current?.type !== 'CallExpression') return false
  const callee = unwrap(current.callee as NodeLike)
  if (callee?.type !== 'MemberExpression' || propertyName(callee) !== 'resolve') return false
  const object = unwrap(callee.object as NodeLike)
  return (
    object?.type === 'Identifier' &&
    object.name === 'Promise' &&
    !findVariable(context, object, true)?.defs.length
  )
}
