import { invokedBodyMatches } from './serial-cursor-immediate.mts'
import { runtimeChildren } from './serial-cursor-runtime-children.mts'
import { propertyName, unwrap, type NodeLike } from './ast-helpers.mts'

export function eagerIteration(
  node: NodeLike | null | undefined,
  methods: ReadonlySet<string>,
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
      (child) => eagerIteration(child, methods),
    )
  )
    return true
  return runtimeChildren(expression).some((child) => eagerIteration(child, methods))
}
