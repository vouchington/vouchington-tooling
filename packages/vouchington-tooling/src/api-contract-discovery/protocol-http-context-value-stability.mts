import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'

type Facts = { writes: ts.Expression[]; calls: (ts.CallExpression | ts.NewExpression)[] }
/** One proof indexes source mutations once; aliases and forwarded parameters retain their roots. */
export function createContextValueStability(checker: ts.TypeChecker) {
  const { root, primitiveMember } = createContextValueRoots(checker)
  const cache = new Map<ts.Symbol, boolean>()
  const sources = new Map<ts.SourceFile, Facts>()
  function facts(source: ts.SourceFile): Facts {
    const hit = sources.get(source)
    if (hit) return hit
    const result: Facts = { writes: [], calls: [] }
    function visit(node: ts.Node) {
      const write = ts.isDeleteExpression(node)
        ? node.expression
        : ts.isBinaryExpression(node) &&
            node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          ? node.left
          : (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
              (node.operator === ts.SyntaxKind.PlusPlusToken ||
                node.operator === ts.SyntaxKind.MinusMinusToken)
            ? node.operand
            : undefined
      if (write) result.writes.push(write)
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) result.calls.push(node)
      ts.forEachChild(node, visit)
    }
    visit(source)
    sources.set(source, result)
    return result
  }
  function stable(symbol: ts.Symbol, active = new Set<ts.Symbol>()): boolean {
    const hit = cache.get(symbol)
    if (hit !== undefined) return hit
    const declaration = symbol.valueDeclaration
    if (!declaration || active.has(symbol)) return false
    const next = new Set(active).add(symbol)
    const data = facts(declaration.getSourceFile())
    let safe = !data.writes.some((expression) => root(expression) === symbol)
    const value =
      ts.isVariableDeclaration(declaration) && declaration.initializer
        ? unwrapExpression(declaration.initializer)
        : declaration
    // A foreign recipient cannot change a function's body; binding writes still invalidate it.
    for (const call of isProtocolCallbackFunction(value) ? [] : data.calls) {
      if (!safe) break
      for (const [index, argument] of (call.arguments ?? []).entries()) {
        if (root(argument) !== symbol || primitiveMember(argument)) continue
        if (
          ts.isPropertyAccessExpression(call.expression) &&
          [
            'assign',
            'set',
            'defineProperty',
            'defineProperties',
            'deleteProperty',
            'setPrototypeOf',
          ].includes(call.expression.name.text)
        ) {
          if (index === 0) safe = false
          continue
        }
        const implementation = checker.getResolvedSignature(call)?.declaration
        const parameter =
          implementation &&
          isProtocolCallbackFunction(implementation) &&
          runtimeParameters(implementation)[index]
        const binding =
          parameter &&
          ts.isIdentifier(parameter.name) &&
          checker.getSymbolAtLocation(parameter.name)
        if (
          !implementation ||
          !('body' in implementation) ||
          !implementation.body ||
          !binding ||
          !stable(binding, next)
        )
          safe = false
      }
    }
    cache.set(symbol, safe)
    return safe
  }
  return stable
}
