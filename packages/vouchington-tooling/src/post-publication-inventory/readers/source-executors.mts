import type { ReaderSourceAnalysisOptions } from './source-options.mts'
import { isNode, propertyName, walk } from './source-ast.mts'

type Node = import('./source-ast.mts').UnknownNode

export function terminalSqlExecutorBindings(
  ast: Node,
  options: ReaderSourceAnalysisOptions,
): Set<string> {
  const bindings = new Set<string>()
  walk(ast, (node) => {
    if (
      node.type !== 'ImportDeclaration' ||
      !isNode(node.source) ||
      node.source.type !== 'Literal' ||
      typeof node.source.value !== 'string' ||
      !options.sql.executorImports.has(node.source.value) ||
      !Array.isArray(node.specifiers)
    ) {
      return
    }
    for (const specifier of node.specifiers) {
      if (!isNode(specifier) || specifier.type !== 'ImportSpecifier') continue
      const importedName = propertyName(specifier.imported as Node)
      const localName = propertyName(specifier.local as Node)
      if (
        importedName &&
        localName &&
        options.sql.executorImports.get(String(node.source.value))?.has(importedName)
      ) {
        bindings.add(localName)
      }
    }
  })
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || !isNode(node.id) || !isNode(node.init)) return
    const binding = propertyName(node.id)
    if (!binding || node.init.type !== 'ConditionalExpression') return
    const consequent = propertyName(isNode(node.init.consequent) ? node.init.consequent : undefined)
    const alternate = propertyName(isNode(node.init.alternate) ? node.init.alternate : undefined)
    if ((consequent && bindings.has(consequent)) || (alternate && bindings.has(alternate))) {
      bindings.add(binding)
    }
  })
  return bindings
}
