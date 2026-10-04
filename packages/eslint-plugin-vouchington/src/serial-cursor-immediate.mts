import { type NodeLike } from './ast-helpers.mts'

function bodyMatches(node: NodeLike, matches: (node: NodeLike) => boolean): boolean {
  if (
    [
      'FunctionDeclaration',
      'FunctionExpression',
      'ArrowFunctionExpression',
      'ClassDeclaration',
      'ClassExpression',
    ].includes(node.type)
  )
    return false
  if (matches(node)) return true
  return Object.entries(node).some(([key, value]) => {
    if (key === 'parent') return false
    const children: unknown[] = Array.isArray(value) ? value : [value]
    return children.some(
      (child) =>
        child !== null &&
        typeof child === 'object' &&
        'type' in child &&
        typeof child.type === 'string' &&
        bodyMatches(child as NodeLike, matches),
    )
  })
}

export function invokedBodyMatches(
  callee: NodeLike | null | undefined,
  args: readonly NodeLike[],
  matches: (node: NodeLike) => boolean,
): boolean {
  if (
    !callee ||
    !['ArrowFunctionExpression', 'FunctionExpression'].includes(callee.type) ||
    callee.generator
  )
    return false
  const parameters = callee.params as NodeLike[]
  return (
    parameters.some(
      (parameter, index) => index >= args.length && bodyMatches(parameter, matches),
    ) || bodyMatches(callee.body as NodeLike, matches)
  )
}
