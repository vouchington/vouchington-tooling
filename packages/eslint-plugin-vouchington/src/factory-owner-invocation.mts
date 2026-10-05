import {
  findVariable,
  propertyName,
  unwrap,
  type NodeLike,
  type RuleContextLike,
} from './ast-helpers.mts'

function isUnshadowedGlobal(
  context: RuleContextLike,
  value: NodeLike | null | undefined,
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
  callee: NodeLike,
  args: readonly NodeLike[],
  isFactory: (value: NodeLike | null | undefined) => boolean,
): boolean {
  const member = callTarget(callee)
  if (member?.type !== 'MemberExpression') return false
  const object = finalSequenceValue(member.object as NodeLike)
  const reflectGlobal =
    isUnshadowedGlobal(context, object, 'Reflect') ||
    (object?.type === 'MemberExpression' &&
      propertyName(object) === 'Reflect' &&
      isUnshadowedGlobal(context, finalSequenceValue(object.object as NodeLike), 'globalThis'))
  if (!reflectGlobal) return false
  const method = propertyName(member)
  return (method === 'apply' || method === 'construct') && isFactory(args[0])
}

function finalSequenceValue(value: NodeLike | null | undefined): NodeLike | null | undefined {
  const current = unwrap(value)
  return current?.type === 'SequenceExpression'
    ? finalSequenceValue((current.expressions as NodeLike[]).at(-1))
    : current
}

function callTarget(value: NodeLike): NodeLike {
  const current = unwrap(value) as NodeLike
  return current.type === 'TSInstantiationExpression'
    ? callTarget(current.expression as NodeLike)
    : current
}

function directFactoryMember(
  callee: NodeLike,
  isFactory: (value: NodeLike | null | undefined) => boolean,
): boolean {
  const member = callTarget(callee)
  if (member?.type !== 'MemberExpression') return false
  const method = propertyName(member)
  return (method === 'call' || method === 'apply') && isFactory(member.object as NodeLike)
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
      if (
        isFactory(callee) ||
        directFactoryMember(callee, isFactory) ||
        directReflectFactory(context, callee, args, isFactory)
      )
        report(value)
    },
    NewExpression(value) {
      if (isFactory(value.callee as NodeLike)) report(value)
    },
    TaggedTemplateExpression(value) {
      const tag = value.tag as NodeLike
      if (isFactory(tag) || directFactoryMember(tag, isFactory)) report(value)
    },
    Decorator(value) {
      if (isFactory(value.expression as NodeLike)) report(value)
    },
  }
}
