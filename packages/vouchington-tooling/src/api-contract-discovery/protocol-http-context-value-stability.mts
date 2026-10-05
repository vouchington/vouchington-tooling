import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'

type Facts = { writes: ts.Expression[]; calls: (ts.CallExpression | ts.NewExpression)[] }
/** One proof indexes source mutations once; aliases and forwarded parameters retain their roots. */
export function createContextValueStability(checker: ts.TypeChecker) {
  const cache = new Map<ts.Symbol, boolean>()
  const sources = new Map<ts.SourceFile, Facts>()
  function root(node: ts.Expression, seen = new Set<ts.Symbol>()): ts.Symbol | undefined {
    node = unwrapExpression(node)
    while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      node = unwrapExpression(node.expression)
    if (!ts.isIdentifier(node)) return undefined
    const found = checker.getSymbolAtLocation(node)
    const value = found && !seen.has(found) ? found.valueDeclaration : undefined
    const next = new Set(seen)
    if (found) next.add(found)
    if (value && ts.isVariableDeclaration(value) && value.initializer) {
      const initializer = unwrapExpression(value.initializer)
      if (ts.isIdentifier(initializer)) return root(initializer, next)
      if (ts.isPropertyAccessExpression(initializer) && !primitiveMember(initializer))
        return (
          selected(initializer.expression, initializer.name.text, next) ??
          root(initializer.expression, next)
        )
    }
    if (value && ts.isBindingElement(value) && ts.isObjectBindingPattern(value.parent)) {
      const owner = value.parent.parent
      const key = value.propertyName ?? value.name
      if (
        ts.isVariableDeclaration(owner) &&
        owner.initializer &&
        (ts.isIdentifier(key) || ts.isStringLiteral(key))
      )
        return selected(owner.initializer, key.text, next) ?? root(owner.initializer, next)
    }
    return found
  }
  function selected(node: ts.Expression, key: string, seen: Set<ts.Symbol>): ts.Symbol | undefined {
    node = unwrapExpression(node)
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node)
      const declaration = symbol?.valueDeclaration
      if (
        !symbol ||
        seen.has(symbol) ||
        !declaration ||
        !ts.isVariableDeclaration(declaration) ||
        !declaration.initializer
      )
        return undefined
      return selected(declaration.initializer, key, new Set(seen).add(symbol))
    }
    if (!ts.isObjectLiteralExpression(node) || node.properties.some(ts.isSpreadAssignment))
      return undefined
    const member = [...node.properties]
      .reverse()
      .find(
        (member) =>
          member.name &&
          (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
          member.name.text === key,
      )
    if (member && ts.isShorthandPropertyAssignment(member)) {
      const target = checker.getShorthandAssignmentValueSymbol(member)
      const declaration = target?.valueDeclaration
      const name =
        declaration && (ts.isVariableDeclaration(declaration) || ts.isBindingElement(declaration))
          ? declaration.name
          : undefined
      return name && ts.isIdentifier(name) ? root(name, seen) : target
    }
    if (member && ts.isPropertyAssignment(member)) {
      const initializer = unwrapExpression(member.initializer)
      if (ts.isPropertyAccessExpression(initializer) && !primitiveMember(initializer))
        return (
          selected(initializer.expression, initializer.name.text, seen) ??
          root(initializer.expression, seen)
        )
      return root(initializer, seen)
    }
    return undefined
  }

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
  function primitiveMember(node: ts.Expression): boolean {
    node = unwrapExpression(node)
    if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return false
    const primitive = (type: ts.Type): boolean =>
      type.isUnion()
        ? type.types.every(primitive)
        : !!(
            type.flags &
            (ts.TypeFlags.StringLike |
              ts.TypeFlags.NumberLike |
              ts.TypeFlags.BooleanLike |
              ts.TypeFlags.BigIntLike |
              ts.TypeFlags.ESSymbolLike |
              ts.TypeFlags.Null |
              ts.TypeFlags.Undefined |
              ts.TypeFlags.Void)
          )
    return primitive(checker.getTypeAtLocation(node))
  }
  function stable(symbol: ts.Symbol, active = new Set<ts.Symbol>()): boolean {
    const hit = cache.get(symbol)
    if (hit !== undefined) return hit
    const declaration = symbol.valueDeclaration
    if (!declaration || active.has(symbol)) return false
    const next = new Set(active).add(symbol)
    const data = facts(declaration.getSourceFile())
    let safe = !data.writes.some((expression) => root(expression) === symbol)
    for (const call of data.calls) {
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
