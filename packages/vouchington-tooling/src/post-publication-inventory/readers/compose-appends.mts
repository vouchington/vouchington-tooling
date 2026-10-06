import type { ReaderSourceAnalysisOptions } from './source-options.mts'
import { isNode, propertyName, walk } from './source-ast.mts'
import {
  addBindingComposition,
  addComposedNames,
  appendReceiverName,
  canonicalCallNames,
  isAppendCall,
  isPushCall,
} from './source-helpers.mts'

type Node = import('./source-ast.mts').UnknownNode

export function composeAppendAndPush(
  ast: Node,
  imported: Set<string>,
  canonicalBindings: Map<string, { declaredAt: number; names: string[] }>,
  localSqlStatements: Set<string>,
  consumedSqlStatements: Set<string>,
  consumedBindings: Set<string>,
  reassignedBindings: Set<string>,
  composed: Set<string>,
  options: ReaderSourceAnalysisOptions,
): void {
  walk(ast, (node: Node) => {
    if (node.type !== 'ForOfStatement' || !isNode(node.right)) return
    const binding = propertyName(node.right)
    if (binding) consumedBindings.add(binding)
  })
  walk(ast, (node: Node) => {
    if (!isAppendCall(node, options) || !Array.isArray(node.arguments)) return
    const receiver = appendReceiverName(node)
    if (receiver && localSqlStatements.has(receiver) && !consumedSqlStatements.has(receiver)) {
      return
    }
    for (const argument of node.arguments) {
      addComposedNames(composed, canonicalCallNames(argument as Node, imported))
      const binding = propertyName(argument as Node)
      const declaration = canonicalBindings.get(binding ?? '')
      if (declaration && argument.range[0] > declaration.declaredAt)
        addBindingComposition(composed, declaration, reassignedBindings.has(binding ?? ''))
    }
  })
  walk(ast, (node: Node) => {
    if (!isPushCall(node) || !Array.isArray(node.arguments)) return
    const collection = appendReceiverName(node)
    if (!collection || !consumedBindings.has(collection)) return
    for (const argument of node.arguments) {
      addComposedNames(composed, canonicalCallNames(argument as Node, imported))
      const binding = propertyName(argument as Node)
      addBindingComposition(
        composed,
        canonicalBindings.get(binding ?? ''),
        reassignedBindings.has(binding ?? ''),
      )
    }
  })
}
