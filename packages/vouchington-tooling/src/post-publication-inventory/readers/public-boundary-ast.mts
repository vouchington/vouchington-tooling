import { isNode, propertyName, walk } from './source-ast.mts'

type Node = import('./source-ast.mts').UnknownNode

export function walkWithAncestors(
  node: Node,
  ancestors: Node[],
  visit: (node: Node, ancestors: Node[]) => void,
): void {
  visit(node, ancestors)
  const nextAncestors = [...ancestors, node]
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) walkWithAncestors(child, nextAncestors, visit)
      }
    } else if (isNode(value)) {
      walkWithAncestors(value, nextAncestors, visit)
    }
  }
}

export function isSetHasCall(node: Node): boolean {
  return (
    node.type === 'CallExpression' &&
    isNode(node.callee) &&
    node.callee.type === 'MemberExpression' &&
    isNode(node.callee.property) &&
    propertyName(node.callee.property) === 'has'
  )
}

export function containsNode(root: Node, target: Node): boolean {
  let found = false
  walk(root, (node) => {
    if (node === target) found = true
  })
  return found
}
