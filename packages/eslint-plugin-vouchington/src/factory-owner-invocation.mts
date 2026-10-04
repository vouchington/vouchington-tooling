import {
  findVariable,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'

function isUnshadowedGlobal(
  context: RuleContextLike,
  value: NodeLike | undefined,
  name: string,
): boolean {
  return (
    value?.type === 'Identifier' &&
    value.name === name &&
    !findVariable(context, value, true)?.defs.length
  )
}

function directReflectFactory(
  context: RuleContextLike,
  callee: NodeLike | null | undefined,
  args: readonly NodeLike[],
  isFactory: (value: NodeLike | null | undefined) => boolean,
): boolean {
  const member = unwrap(callee)
  if (member?.type !== 'MemberExpression') return false
  if (!isUnshadowedGlobal(context, member.object as NodeLike, 'Reflect')) return false
  const method = propertyName(member)
  return (method === 'apply' || method === 'construct') && isFactory(args[0])
}

export function createFactoryInvocationVisitors(
  context: RuleContextLike,
  isFactory: (value: NodeLike | null | undefined) => boolean,
): Record<string, (node: NodeLike) => void> {
  const report = (value: NodeLike) =>
    context.report({ node: value, messageId: 'constructionOwner' })
  return {
    CallExpression(value) {
      const callee = value.callee as NodeLike
      const args = value.arguments as NodeLike[]
      if (isFactory(callee) || directReflectFactory(context, callee, args, isFactory)) report(value)
    },
    NewExpression(value) {
      if (isFactory(value.callee as NodeLike)) report(value)
    },
    TaggedTemplateExpression(value) {
      if (isFactory(value.tag as NodeLike)) report(value)
    },
    Decorator(value) {
      if (isFactory(value.expression as NodeLike)) report(value)
    },
  }
}
