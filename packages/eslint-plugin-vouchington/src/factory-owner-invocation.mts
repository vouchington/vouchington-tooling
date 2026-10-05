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
  const member = unwrap(callee)
  if (member?.type !== 'MemberExpression') return false
  const object = finalSequenceValue(member.object as NodeLike)
  const reflectGlobal =
    isUnshadowedGlobal(context, object, 'Reflect') ||
    (object?.type === 'MemberExpression' &&
      propertyName(object) === 'Reflect' &&
      isUnshadowedGlobal(context, finalSequenceValue(object.object as NodeLike), 'globalThis'))
  if (!reflectGlobal) return false
  const method = propertyName(member)
  const argumentList = method === 'apply' ? args[2] : method === 'construct' ? args[1] : undefined
  const newTarget = method === 'construct' ? args[2] : undefined
  return Boolean(
    argumentList &&
    !isStaticPrimitive(context, argumentList) &&
    !isKnownNonConstructor(context, newTarget) &&
    isFactory(args[0]),
  )
}

function isStaticPrimitive(context: RuleContextLike, value: NodeLike): boolean {
  const current = unwrap(value)
  return Boolean(
    (current?.type === 'Literal' && !current.regex) ||
    current?.type === 'TemplateLiteral' ||
    current?.type === 'UnaryExpression' ||
    (current?.type === 'Identifier' &&
      ['undefined', 'NaN', 'Infinity'].includes(String(current.name)) &&
      !findVariable(context, current, true)?.defs.length),
  )
}

function isKnownNonConstructor(context: RuleContextLike, value: NodeLike | undefined): boolean {
  const current = unwrap(value)
  return Boolean(
    current &&
    (isStaticPrimitive(context, current) ||
      current.type === 'ObjectExpression' ||
      current.type === 'ArrayExpression' ||
      (current.type === 'Literal' && Boolean(current.regex)) ||
      current.type === 'ArrowFunctionExpression' ||
      (current.type === 'FunctionExpression' && (current.async || current.generator))),
  )
}

function finalSequenceValue(value: NodeLike | null | undefined): NodeLike | null | undefined {
  const current = unwrap(value)
  return current?.type === 'SequenceExpression'
    ? finalSequenceValue((current.expressions as NodeLike[]).at(-1))
    : current
}

function directFactoryMember(
  context: RuleContextLike,
  callee: NodeLike,
  args: readonly NodeLike[],
  isFactory: (value: NodeLike | null | undefined) => boolean,
): boolean {
  const member = unwrap(callee)
  if (member?.type !== 'MemberExpression') return false
  const method = propertyName(member)
  if (method === 'apply') {
    const argumentList = unwrap(args[1])
    const emptyList =
      argumentList?.type === 'Literal' && argumentList.value === null
        ? true
        : argumentList?.type === 'Identifier' &&
          argumentList.name === 'undefined' &&
          !findVariable(context, argumentList, true)?.defs.length
    if (argumentList && !emptyList && isStaticPrimitive(context, argumentList)) return false
  }
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
        directFactoryMember(context, callee, args, isFactory) ||
        directReflectFactory(context, callee, args, isFactory)
      )
        report(value)
    },
    NewExpression(value) {
      if (isFactory(value.callee as NodeLike)) report(value)
    },
    TaggedTemplateExpression(value) {
      const tag = value.tag as NodeLike
      if (isFactory(tag) || directFactoryMember(context, tag, [], isFactory)) report(value)
    },
    Decorator(value) {
      if (isFactory(value.expression as NodeLike)) report(value)
    },
  }
}
