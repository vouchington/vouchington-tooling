import type { ReaderSourceAnalysisOptions } from './source-options.mts'
import { composeAppendAndPush } from './compose-appends.mts'
import { isNode, parseSource, propertyName, walk } from './source-ast.mts'
import {
  addBindingComposition,
  addComposedNames,
  appendReceiverName,
  canonicalCallNames,
  importedCanonicalBindings,
  isAppendCall,
  isPushCall,
  isSqlStatementInitializer,
  isTerminalSqlCall,
  terminalSqlExecutorBindings,
} from './source-helpers.mts'

type Node = import('./source-ast.mts').UnknownNode

export function sourceImportsAndComposesAny(
  content: string,
  symbols: string[],
  options: ReaderSourceAnalysisOptions,
): boolean {
  const ast = parseSource(content).ast
  const terminalExecutors = terminalSqlExecutorBindings(ast, options)
  const imported = importedCanonicalBindings(ast, symbols, options)
  if (imported.size === 0) return false

  const canonicalBindings = new Map<string, { declaredAt: number; names: string[] }>()
  const localSqlStatements = new Set<string>()
  const localCollections = new Set<string>()
  const consumedSqlStatements = new Set<string>()
  const consumedBindings = new Set<string>()
  const reassignedBindings = new Set<string>()
  const composed = new Set<string>()
  walk(ast, (node: Node) => {
    if (node.type !== 'VariableDeclarator') return
    const binding = propertyName(isNode(node.id) ? node.id : undefined)
    const initializer = isNode(node.init) ? node.init : undefined
    if (binding && isSqlStatementInitializer(initializer, options)) localSqlStatements.add(binding)
    if (binding && initializer?.type === 'ArrayExpression') localCollections.add(binding)
    const canonicalCalls = canonicalCallNames(initializer, imported)
    if (binding && canonicalCalls.length > 0) {
      canonicalBindings.set(binding, { declaredAt: node.range[1], names: canonicalCalls })
    }
  })
  walk(ast, (node: Node) => {
    if (node.type !== 'AssignmentExpression' || !isNode(node.left)) return
    const binding = propertyName(node.left)
    if (binding) reassignedBindings.add(binding)
  })
  walk(ast, (node: Node) => {
    if (node.type === 'ReturnStatement' && isNode(node.argument)) {
      const binding = propertyName(node.argument)
      if (binding) consumedSqlStatements.add(binding)
      if (binding) consumedBindings.add(binding)
      addComposedNames(composed, canonicalCallNames(node.argument, imported))
      addBindingComposition(
        composed,
        canonicalBindings.get(binding ?? ''),
        reassignedBindings.has(binding ?? ''),
      )
      return
    }
    if (node.type !== 'CallExpression' || !Array.isArray(node.arguments)) return
    const appends = isAppendCall(node, options)
    const pushes = isPushCall(node)
    const terminal = isTerminalSqlCall(node, terminalExecutors)
    const pushReceiver = pushes ? appendReceiverName(node) : null
    for (const argument of node.arguments) {
      const binding = propertyName(argument as Node)
      if (!binding) continue
      if (terminal) {
        consumedSqlStatements.add(binding)
      }
      if (pushes && pushReceiver && !localCollections.has(pushReceiver)) {
        consumedSqlStatements.add(binding)
      }
      if (!appends || appendReceiverName(node) !== binding) consumedBindings.add(binding)
    }
    if (
      !appends &&
      !isPushCall(node) &&
      isNode(node.callee) &&
      node.callee.type === 'MemberExpression'
    ) {
      const receiver = propertyName(isNode(node.callee.object) ? node.callee.object : undefined)
      if (receiver) consumedBindings.add(receiver)
    }
  })
  composeAppendAndPush(
    ast,
    imported,
    canonicalBindings,
    localSqlStatements,
    consumedSqlStatements,
    consumedBindings,
    reassignedBindings,
    composed,
    options,
  )
  return [...imported].some((name) => composed.has(name))
}
