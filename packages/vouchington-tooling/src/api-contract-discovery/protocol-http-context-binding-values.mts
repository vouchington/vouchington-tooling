import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'

export function defaultBindingValue(
  value: ts.Expression | undefined,
  initializer: ts.Expression | undefined,
  checker: ts.TypeChecker,
): ts.Expression | undefined {
  const actual = value && unwrapExpression(value)
  return !actual ||
    ts.isVoidExpression(actual) ||
    (ts.isIdentifier(actual) &&
      actual.text === 'undefined' &&
      !checker.getSymbolAtLocation(actual)?.valueDeclaration)
    ? initializer
    : value
}
function providedBindingValue(value: ts.Expression, checker: ts.TypeChecker): boolean {
  const actual =
    createProtocolCallbackValueResolver(checker).resolve(value, new Map())?.node ??
    unwrapExpression(value)
  return (
    !!actual &&
    (ts.isObjectLiteralExpression(actual) ||
      ts.isArrayLiteralExpression(actual) ||
      ts.isLiteralExpression(actual) ||
      ts.isArrowFunction(actual) ||
      ts.isFunctionExpression(actual) ||
      ts.isClassExpression(actual) ||
      [ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(
        actual.kind,
      ))
  )
}

/** Unknown supplied values cannot prove that a selected binding default stays inactive. */
export function unknownContextBindingDefault(
  element: ts.BindingElement | ts.OmittedExpression,
  checker: ts.TypeChecker,
  selected: (value: ts.Expression) => boolean,
  bindingValue: (value: ts.Expression, checker: ts.TypeChecker) => ts.Expression | undefined,
): boolean {
  if (ts.isOmittedExpression(element) || !element.initializer || !selected(element.initializer))
    return false
  const value = ts.isIdentifier(element.name) && bindingValue(element.name, checker)
  return !value || (value !== element.initializer && !providedBindingValue(value, checker))
}
