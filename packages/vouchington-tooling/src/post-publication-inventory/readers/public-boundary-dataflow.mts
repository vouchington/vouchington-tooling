import { derivedBindingIsConsumed } from './public-boundary-consumed.mts'
import { isFunctionLike, isNode, propertyName } from './source-ast.mts'
import { containsNode } from './public-boundary-ast.mts'

type Node = import('./source-ast.mts').UnknownNode

export function constrainingUseReachesConsumer(
  hasCall: Node,
  ancestors: Node[],
  ast: Node,
): boolean {
  let crossedCallback = false
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]!
    if (isFunctionLike(ancestor)) {
      if (crossedCallback) return false
      crossedCallback = true
      continue
    }
    if (ancestor.type === 'ReturnStatement') return true
    if (ancestor.type !== 'CallExpression' || !isNode(ancestor.callee)) continue
    const callName =
      ancestor.callee.type === 'Identifier'
        ? propertyName(ancestor.callee)
        : ancestor.callee.type === 'MemberExpression' && isNode(ancestor.callee.property)
          ? propertyName(ancestor.callee.property)
          : null
    if (callName === 'assert') return true
    if (!['filter', 'flatMap', 'map'].includes(callName ?? '')) {
      if (crossedCallback) return false
      continue
    }
    if (!hasCallDeterminesCallbackResult(hasCall, ancestors.slice(index + 1))) return false
    return derivedCallReachesConsumer(ancestors.slice(0, index), ast)
  }
  return false
}

function hasCallDeterminesCallbackResult(hasCall: Node, descendants: Node[]): boolean {
  const callback = descendants.find(isFunctionLike)
  if (!callback || !isNode(callback.body)) return false
  if (callback.body.type !== 'BlockStatement') return containsNode(callback.body, hasCall)
  return descendants.some((descendant) => descendant.type === 'ReturnStatement')
}

function derivedCallReachesConsumer(ancestors: Node[], ast: Node): boolean {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]!
    if (ancestor.type === 'ReturnStatement') return true
    if (ancestor.type === 'AssignmentExpression' && isNode(ancestor.left)) {
      if (ancestor.left.type === 'MemberExpression') return true
      const name = propertyName(ancestor.left)
      return name ? derivedBindingIsConsumed(ast, name, ancestor.range[1]) : false
    }
    if (ancestor.type === 'VariableDeclarator' && isNode(ancestor.id)) {
      const name = propertyName(ancestor.id)
      return name ? derivedBindingIsConsumed(ast, name, ancestor.range[1]) : false
    }
  }
  return false
}
