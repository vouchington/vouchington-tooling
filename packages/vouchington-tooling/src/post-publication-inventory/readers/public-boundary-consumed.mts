import { isNode, propertyName } from './source-ast.mts'
import { walkWithAncestors } from './public-boundary-ast.mts'
type Node = import('./source-ast.mts').UnknownNode

export function derivedBindingIsConsumed(ast: Node, name: string, declaredAt: number): boolean {
  let consumed = false
  walkWithAncestors(ast, [], (node, ancestors) => {
    if (consumed || node.range[0] <= declaredAt) return
    if (node.type === 'Identifier' && propertyName(node) === name) {
      if (ancestors.some((ancestor) => ancestor.type === 'ReturnStatement')) consumed = true
      if (
        ancestors.some((ancestor) => ancestor.type === 'ForOfStatement' && ancestor.right === node)
      ) {
        consumed = true
      }
      return
    }
    if (node.type !== 'MemberExpression' || !isNode(node.object)) return
    if (propertyName(node.object) !== name) return
    const method = isNode(node.property) ? propertyName(node.property) : null
    if (!['entries', 'filter', 'flatMap', 'map'].includes(method ?? '')) return
    const call = ancestors.at(-1)
    if (!call || call.type !== 'CallExpression') return
    if (ancestors.some((ancestor) => ancestor.type === 'ReturnStatement')) {
      consumed = true
      return
    }
    const declaration = [...ancestors]
      .toReversed()
      .find((ancestor) => ancestor.type === 'VariableDeclarator' && isNode(ancestor.id))
    const derivedName = declaration && isNode(declaration.id) ? propertyName(declaration.id) : null
    if (declaration && derivedName) {
      consumed = derivedBindingIsConsumed(ast, derivedName, declaration.range[1])
    }
  })
  return consumed
}
