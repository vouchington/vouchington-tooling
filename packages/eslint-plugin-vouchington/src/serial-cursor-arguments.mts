import { propertyName, unwrap, type NodeLike } from './ast-helpers.mts'

export function eagerIteration(
  node: NodeLike | null | undefined,
  methods: ReadonlySet<string>,
): boolean {
  const expression = unwrap(node)
  if (!expression) return false
  if (expression.type === 'AwaitExpression' || expression.type === 'SpreadElement')
    return eagerIteration(expression.argument as NodeLike | undefined, methods)
  if (expression.type === 'LogicalExpression')
    return (
      eagerIteration(expression.left as NodeLike, methods) ||
      eagerIteration(expression.right as NodeLike, methods)
    )
  if (expression.type === 'ConditionalExpression')
    return (
      eagerIteration(expression.test as NodeLike, methods) ||
      eagerIteration(expression.consequent as NodeLike, methods) ||
      eagerIteration(expression.alternate as NodeLike, methods)
    )
  if (expression.type === 'ArrayExpression' || expression.type === 'SequenceExpression') {
    const children = (expression.elements ?? expression.expressions) as (NodeLike | null)[]
    return children.some((child) => eagerIteration(child, methods))
  }
  if (expression.type === 'MemberExpression')
    return (
      eagerIteration(expression.object as NodeLike, methods) ||
      (Boolean(expression.computed) && eagerIteration(expression.property as NodeLike, methods))
    )
  const callee = unwrap(expression.callee as NodeLike | undefined)
  const iterator = propertyName(callee)
  if (
    expression.type === 'CallExpression' &&
    callee?.type === 'MemberExpression' &&
    typeof iterator === 'string' &&
    methods.has(iterator)
  )
    return true
  if (expression.type === 'CallExpression' || expression.type === 'NewExpression')
    return (
      eagerIteration(callee, methods) ||
      (expression.arguments as NodeLike[]).some((argument) => eagerIteration(argument, methods))
    )
  return false
}
