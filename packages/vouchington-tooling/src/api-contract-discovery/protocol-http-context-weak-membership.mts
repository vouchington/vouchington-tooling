import ts from '../contract-schema/typescript-api.mts'
import { standardCompilerDeclaration } from './protocol-platform-callbacks.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { httpContextArgument } from './protocol-http-context.mts'
import { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import { createContextCapture } from './protocol-http-context-capture.mts'
import { contextMutationTargets } from './protocol-http-context-write-targets.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'

/** Weak membership cannot retrieve or invoke a selected key; receiver escape invalidates it. */
export function createHttpContextWeakMembershipProof(
  checker: ts.TypeChecker,
  sources: readonly ts.SourceFile[],
) {
  const roots = createContextValueRoots(checker)
  const capture = createContextCapture(checker, roots)
  const nodes: ts.Node[] = []
  const safe = new Map<ts.Symbol, boolean>()
  function visit(node: ts.Node): void {
    if (!potentiallyExecuted(node)) return
    nodes.push(node)
    ts.forEachChild(node, visit)
  }
  sources.filter((source) => !source.isDeclarationFile).forEach(visit)
  function stable(symbol: ts.Symbol, constructor: ts.Symbol): boolean {
    if (safe.has(symbol)) return safe.get(symbol)!
    const refers = (value: ts.Expression, selected: ts.Symbol) =>
      roots.referencesContainer(value, selected, undefined, capture(value))
    const result = !nodes.some((node) => {
      if (
        contextMutationTargets(node).some(
          (value) =>
            refers(value, symbol) ||
            refers(value, constructor) ||
            checker.getSymbolAtLocation(value) === constructor,
        )
      )
        return true
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        node.arguments?.some((value) => refers(value, symbol) || refers(value, constructor))
      )
        return true
      if (
        (ts.isReturnStatement(node) || ts.isExportAssignment(node)) &&
        node.expression &&
        (refers(node.expression, symbol) || refers(node.expression, constructor))
      )
        return true
      return (
        ts.isExportSpecifier(node) &&
        [symbol, constructor].includes(roots.root(node.propertyName ?? node.name)!)
      )
    })
    safe.set(symbol, result)
    return result
  }
  return (call: ts.CallExpression, context: ts.Symbol): boolean => {
    const method = unwrapExpression(call.expression)
    if (
      !ts.isPropertyAccessExpression(method) ||
      !['has', 'add'].includes(method.name.text) ||
      call.questionDotToken ||
      call.arguments.length !== 1 ||
      !httpContextArgument(call.arguments[0]!, context, checker)
    )
      return false
    const receiver = expressionReceiver(method.expression, checker)
    const declaration = receiver?.root.valueDeclaration
    if (
      !receiver ||
      receiver.path.length ||
      receiver.mutableAlias ||
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      !declaration.initializer
    )
      return false
    if (
      ts.isVariableStatement(declaration.parent.parent) &&
      declaration.parent.parent.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    )
      return false
    const allocation = unwrapExpression(declaration.initializer)
    if (!ts.isNewExpression(allocation) || allocation.arguments?.length) return false
    const constructor = checker.getSymbolAtLocation(allocation.expression)
    const member = checker.getSymbolAtLocation(method.name)
    return (
      !!constructor &&
      constructor.name === 'WeakSet' &&
      !!constructor.declarations?.length &&
      constructor.declarations.every((node) => standardCompilerDeclaration(node, checker)) &&
      !!member?.declarations?.length &&
      member.declarations.every((node) => standardCompilerDeclaration(node, checker)) &&
      stable(receiver.root, constructor)
    )
  }
}
