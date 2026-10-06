import ts from '../contract-schema/typescript-api.mts'
import {
  defaultBindingValue,
  unknownContextBindingDefault,
} from './protocol-http-context-binding-values.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'

function literalInitializer(node: ts.VariableDeclaration, checker: ts.TypeChecker) {
  return (
    node.initializer &&
    createProtocolCallbackValueResolver(checker).resolve(node.initializer, new Map())?.node
  )
}
/** Select one actual literal binding value, retaining its original compiler identity. */
export function contextLiteralBinding(
  value: ts.Expression,
  checker: ts.TypeChecker,
): ts.Expression | undefined {
  if (!ts.isIdentifier(value)) return undefined
  const binding = checker.getSymbolAtLocation(value)?.valueDeclaration
  if (!binding || !ts.isBindingElement(binding) || binding.dotDotDotToken) return undefined
  const owner = binding.parent.parent
  if (!ts.isVariableDeclaration(owner)) return undefined
  const source = literalInitializer(owner, checker)
  if (
    source &&
    ts.isArrayBindingPattern(binding.parent) &&
    ts.isArrayLiteralExpression(source) &&
    !source.elements.some(ts.isSpreadElement)
  ) {
    const selected = source.elements[binding.parent.elements.indexOf(binding)]
    return defaultBindingValue(
      selected && !ts.isOmittedExpression(selected) ? selected : undefined,
      binding.initializer,
      checker,
    )
  }
  const key = binding.propertyName ?? binding.name
  if (
    !source ||
    !ts.isObjectLiteralExpression(source) ||
    source.properties.some(ts.isSpreadAssignment) ||
    !(ts.isIdentifier(key) || ts.isStringLiteral(key))
  )
    return undefined
  const member = source.properties.findLast(
    (member) =>
      member.name &&
      (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
      member.name.text === key.text,
  )
  if (member && ts.isPropertyAssignment(member))
    return defaultBindingValue(member.initializer, binding.initializer, checker)
  if (member && ts.isShorthandPropertyAssignment(member)) {
    const declaration = checker.getShorthandAssignmentValueSymbol(member)?.valueDeclaration
    return declaration &&
      (ts.isParameter(declaration) || ts.isVariableDeclaration(declaration)) &&
      ts.isIdentifier(declaration.name)
      ? declaration.name
      : undefined
  }
  return !member ? binding.initializer : undefined
}
/** Unsupported destructures of a selected literal container cannot erase its capabilities. */
export function unsupportedLiteralContextBinding(
  node: ts.VariableDeclaration,
  checker: ts.TypeChecker,
  selected: (value: ts.Expression) => boolean,
): boolean {
  if (ts.isIdentifier(node.name) || !node.initializer) return false
  const source = literalInitializer(node, checker)
  if (
    node.name.elements.some((element) =>
      unknownContextBindingDefault(element, checker, selected, contextLiteralBinding),
    )
  )
    return true
  if (!source || !ts.isExpression(source) || !selected(source)) return false
  const simple = node.name.elements.every(
    (element) =>
      ts.isOmittedExpression(element) ||
      (!element.dotDotDotToken &&
        ts.isIdentifier(element.name) &&
        (!element.propertyName ||
          ts.isIdentifier(element.propertyName) ||
          ts.isStringLiteral(element.propertyName))),
  )
  const literal =
    (ts.isArrayLiteralExpression(source) && !source.elements.some(ts.isSpreadElement)) ||
    (ts.isObjectLiteralExpression(source) && !source.properties.some(ts.isSpreadAssignment))
  return !simple || !literal
}
/** Construction reaches this actual class's instance initializers and constructor body. */
export function constructedContextCapture(
  node: ts.NewExpression,
  checker: ts.TypeChecker,
  selected: (value: ts.Expression) => boolean,
): boolean {
  let target: ts.Node | undefined = unwrapExpression(node.expression)
  if (!ts.isClassExpression(target)) {
    const symbol = checker.getSymbolAtLocation(target)
    const resolved =
      symbol?.flags && symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol
    target = resolved?.valueDeclaration
    if (target && ts.isVariableDeclaration(target) && target.initializer)
      target = unwrapExpression(target.initializer)
  }
  if (!target || (!ts.isClassDeclaration(target) && !ts.isClassExpression(target))) return false
  return target.members.some((member) => {
    if (ts.isConstructorDeclaration(member) && member.body) {
      function captured(value: ts.Node): boolean {
        if (
          ts.isTypeNode(value) ||
          ts.isClassLike(value) ||
          !executableProtocolPath(value, checker, member)
        )
          return false
        if (ts.isFunctionLike(value))
          return (
            'body' in value &&
            !!value.body &&
            executableProtocolPath(value.body, checker, member) &&
            captured(value.body)
          )
        if (ts.isVariableDeclaration(value))
          return !!value.initializer && captured(value.initializer)
        return (ts.isExpression(value) && selected(value)) || value.forEachChild(captured) === true
      }
      return captured(member.body)
    }
    return (
      ts.isPropertyDeclaration(member) &&
      !!member.initializer &&
      !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) &&
      selected(member.initializer)
    )
  })
}
