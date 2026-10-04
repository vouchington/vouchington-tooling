import { invokedBodyMatches } from './serial-cursor-immediate.mts'
import { runtimeChildren } from './serial-cursor-runtime-children.mts'
import { propertyName, unwrap, type NodeLike, type RuleContextLike } from './ast-helpers.mts'

export function eagerIteration(
  node: NodeLike | null | undefined,
  methods: ReadonlySet<string>,
  context: RuleContextLike,
  consumeIterable = false,
): boolean {
  const expression = unwrap(node)
  if (!expression) return false
  const callee = unwrap((expression.callee ?? expression.tag) as NodeLike | undefined)
  const iterator = propertyName(callee)
  if (
    expression.type === 'CallExpression' &&
    callee?.type === 'MemberExpression' &&
    typeof iterator === 'string' &&
    methods.has(iterator)
  )
    return true
  if (
    ['CallExpression', 'NewExpression', 'TaggedTemplateExpression'].includes(expression.type) &&
    invokedBodyMatches(
      callee,
      expression.type === 'TaggedTemplateExpression'
        ? [
            expression.quasi as NodeLike,
            ...((expression.quasi as NodeLike).expressions as NodeLike[]),
          ]
        : (expression.arguments as NodeLike[]),
      (child) => eagerIteration(child, methods, context),
      context,
      consumeIterable,
    )
  )
    return true
  const children = runtimeChildren(expression)
  return children.some((child, index) => {
    const consumed =
      expression.type === 'SpreadElement'
        ? expression.parent?.type !== 'ObjectExpression'
        : consumeIterable &&
          (['AwaitExpression', 'LogicalExpression'].includes(expression.type) ||
            (expression.type === 'ConditionalExpression' && index > 0) ||
            (expression.type === 'SequenceExpression' && index === children.length - 1) ||
            (expression.type === 'AssignmentExpression' && child === expression.right))
    return eagerIteration(child, methods, context, consumed)
  })
}
