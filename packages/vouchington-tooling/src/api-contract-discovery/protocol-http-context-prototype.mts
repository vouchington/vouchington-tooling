import ts from '../contract-schema/typescript-api.mts'
import { createContextCapture } from './protocol-http-context-capture.mts'
import { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction,
} from './protocol-callback-values.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
import { contextMutationTargets } from './protocol-http-context-write-targets.mts'

/** Missing own properties require unchanged global prototype capabilities in this Program. */
export function createContextPrototypeProof(
  checker: ts.TypeChecker,
  sources?: readonly ts.SourceFile[],
) {
  let result: boolean | undefined
  const roots = createContextValueRoots(checker)
  const capture = createContextCapture(checker, roots)
  function globalObject(symbol: ts.Symbol | undefined): boolean {
    return symbol?.name === 'Object' && !!symbol.valueDeclaration?.getSourceFile().isDeclarationFile
  }
  const callbacks = createProtocolCallbackValueResolver(checker)
  function prototypeCapability(node: ts.Expression, active = new Set<ts.Node>()): boolean {
    node = unwrapExpression(node)
    if (globalObject(roots.root(node))) return true
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteral(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined
      return (
        name === '__proto__' ||
        (name === 'prototype' &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'constructor') ||
        prototypeCapability(node.expression, active)
      )
    }
    if (!ts.isCallExpression(node)) return false
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'getPrototypeOf' &&
      globalObject(roots.root(node.expression))
    )
      return true
    const target = callbacks.resolve(node.expression, new Map())?.node
    if (!target || !isProtocolCallbackFunction(target) || !target.body) return false
    if (active.has(target)) return true
    return returnedExpressions(target).some(
      (value) => !!value && prototypeCapability(value, new Set(active).add(target)),
    )
  }
  return (): boolean => {
    if (result !== undefined) return result
    result = !!sources
    function visit(node: ts.Node) {
      if (!result) return
      if (contextMutationTargets(node).some((target) => prototypeCapability(target))) result = false
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        node.arguments?.some(
          (argument) => prototypeCapability(argument) || [...capture(argument)].some(globalObject),
        )
      )
        result = false
      ts.forEachChild(node, visit)
    }
    for (const source of sources ?? []) visit(source)
    return result
  }
}
