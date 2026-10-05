import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

/** Bounded literal aliases retain mutation origins; only primitive members cannot expose parents. */
export function createContextValueRoots(checker: ts.TypeChecker) {
  function root(node: ts.Expression, seen = new Set<ts.Symbol>()): ts.Symbol | undefined {
    node = unwrapExpression(node)
    while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owner = unwrapExpression(node.expression)
      const binding = ts.isIdentifier(owner) && checker.getSymbolAtLocation(owner)
      const module =
        binding &&
        (binding.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(binding) : binding)
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined
      if (module && module.flags & ts.SymbolFlags.Module && key) {
        const member = checker.getExportsOfModule(module).find((item) => item.name === key)
        return (
          member &&
          (member.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(member) : member)
        )
      }
      node = owner
    }
    if (!ts.isIdentifier(node)) return undefined
    const binding = checker.getSymbolAtLocation(node)
    const found =
      binding?.flags && binding.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(binding)
        : binding
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
      const binding = checker.getSymbolAtLocation(node)
      const symbol =
        binding?.flags && binding.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(binding)
          : binding
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

  function primitiveMember(node: ts.Expression): boolean {
    node = unwrapExpression(node)
    if (!(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) return false
    return primitiveValue(node)
  }
  function primitiveValue(node: ts.Expression): boolean {
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
  return { root, primitiveMember, primitiveValue }
}
