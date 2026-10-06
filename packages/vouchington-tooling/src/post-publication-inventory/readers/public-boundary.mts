import type { ReaderSourceAnalysisOptions } from './source-options.mts'
import { isShadowedAtUse, isThenBoundaryParameter } from './public-boundary-then.mts'
import { isNode, parseSource, propertyName, walk } from './source-ast.mts'
import { importedCanonicalBindings } from './source-helpers.mts'
import { isSetHasCall, walkWithAncestors } from './public-boundary-ast.mts'
import { constrainingUseReachesConsumer } from './public-boundary-dataflow.mts'

type Node = import('./source-ast.mts').UnknownNode
type BoundaryBinding = { declaredAt: number; declaration: Node; name: string }

/** Proves that public IDs constrain a collection or guard before it can be emitted. */
export function sourceFiltersWithPublicBoundary(
  content: string,
  symbols: string[],
  options: ReaderSourceAnalysisOptions,
): boolean {
  const ast = parseSource(content).ast
  const imported = importedCanonicalBindings(ast, symbols, options)
  if (imported.size === 0) return false

  const bindings: BoundaryBinding[] = []
  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator' || !isNode(node.id) || !isNode(node.init)) return
    const name = propertyName(node.id)
    if (!name || !isDirectCanonicalBoundaryCall(node.init, imported)) return
    bindings.push({ declaredAt: node.range[1], declaration: node, name })
  })

  let constrained = false
  walkWithAncestors(ast, [], (node, ancestors) => {
    if (constrained) return
    if (node.type === 'ReturnStatement' && isNode(node.argument)) {
      if (isDirectCanonicalBoundaryCall(node.argument, imported)) {
        constrained = true
        return
      }
      const returned = propertyName(node.argument)
      if (
        returned &&
        bindings.some(
          (binding) =>
            binding.name === returned &&
            node.range[0] > binding.declaredAt &&
            !isShadowedAtUse(binding, ancestors),
        )
      ) {
        constrained = true
      }
      return
    }
    if (
      !isSetHasCall(node) ||
      !hasCandidateIdArgument(node, options) ||
      !constrainingUseReachesConsumer(node, ancestors, ast)
    ) {
      return
    }
    const receiver = propertyName((node.callee as Node).object as Node)
    if (
      receiver &&
      bindings.some(
        (binding) =>
          binding.name === receiver &&
          node.range[0] > binding.declaredAt &&
          !isShadowedAtUse(binding, ancestors),
      )
    ) {
      constrained = true
      return
    }
    if (receiver && isThenBoundaryParameter(receiver, ancestors, imported)) constrained = true
  })
  return constrained
}

function isDirectCanonicalBoundaryCall(node: Node, imported: Set<string>): boolean {
  const expression = node.type === 'AwaitExpression' && isNode(node.argument) ? node.argument : node
  return (
    expression.type === 'CallExpression' &&
    isNode(expression.callee) &&
    expression.callee.type === 'Identifier' &&
    imported.has(expression.callee.name as string)
  )
}

function hasCandidateIdArgument(node: Node, options: ReaderSourceAnalysisOptions): boolean {
  if (!Array.isArray(node.arguments) || !isNode(node.arguments[0])) return false
  const argument = node.arguments[0]
  return (
    argument.type === 'MemberExpression' &&
    isNode(argument.property) &&
    propertyName(argument.property) === options.candidateIdProperty
  )
}
