import type { ReaderSourceAnalysisOptions } from './source-options.mts'
import { isNode, parseSource, propertyName, walk } from './source-ast.mts'
import { canonicalCallNames, importedCanonicalBindings } from './source-helpers.mts'

type Node = import('./source-ast.mts').UnknownNode

export function sourceImportsAndUsesBoundaryAny(
  content: string,
  symbols: string[],
  options: ReaderSourceAnalysisOptions,
): boolean {
  const ast = parseSource(content).ast
  const imported = importedCanonicalBindings(ast, symbols, options)
  if (imported.size === 0) return false

  const resultBindings = new Map<string, number>()
  walk(ast, (node: Node) => {
    if (node.type !== 'VariableDeclarator' || !isNode(node.id) || !isNode(node.init)) return
    const binding = propertyName(node.id)
    const calls = canonicalCallNames(node.init, imported)
    if (!binding && calls.length > 0) imported.add('__used__')
    if (binding && calls.length > 0) {
      resultBindings.set(binding, node.range[1])
    }
  })
  walk(ast, (node: Node) => {
    if (node.type === 'ReturnStatement' && isNode(node.argument)) {
      if (canonicalCallNames(node.argument, imported).length > 0) imported.add('__used__')
      const binding = propertyName(node.argument)
      if (binding && resultBindings.has(binding)) imported.add('__used__')
      return
    }
    if (node.type !== 'CallExpression') return
    if (isMeaningfulBoundaryCall(node, imported, options)) imported.add('__used__')
    for (const argument of node.arguments as Node[]) {
      const binding = propertyName(argument as Node)
      const declaredAt = binding ? resultBindings.get(binding) : undefined
      if (binding && declaredAt !== undefined && argument.range[0] > declaredAt) {
        imported.add('__used__')
      }
    }
  })
  walk(ast, (node: Node) => {
    if (node.type !== 'MemberExpression' || !isNode(node.object)) return
    const binding = propertyName(node.object)
    const declaredAt = binding ? resultBindings.get(binding) : undefined
    if (binding && declaredAt !== undefined && node.range[0] > declaredAt) {
      imported.add('__used__')
    }
  })
  return imported.has('__used__')
}

/** Proves a SQL builder result reaches a live SQL statement or a compositional return/push path. */
function isMeaningfulBoundaryCall(
  node: Node,
  imported: Set<string>,
  options: ReaderSourceAnalysisOptions,
): boolean {
  if (canonicalCallNames(node, imported).length === 0 || !isNode(node.callee)) return false
  if (node.callee.type === 'Identifier') {
    const callee = propertyName(node.callee)
    return callee !== options.ignoredCall && !imported.has(callee ?? '')
  }
  return (
    node.callee.type === 'MemberExpression' &&
    isNode(node.callee.property) &&
    ['all', 'allSettled', 'assert', 'then'].includes(propertyName(node.callee.property) ?? '')
  )
}
