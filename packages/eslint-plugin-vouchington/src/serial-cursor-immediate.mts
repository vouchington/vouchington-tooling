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
  matches: (node: NodeLike) => boolean,
): boolean {
  if (
    !callee ||
    !['ArrowFunctionExpression', 'FunctionExpression'].includes(callee.type) ||
    callee.generator
  )
    return false
  return bodyMatches(callee.body as NodeLike, matches)
}
