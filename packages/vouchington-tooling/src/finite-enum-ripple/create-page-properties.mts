import ts from '@typescript/typescript6'
import { getPropertyNameText, getStringLiteralValue, unwrapExpression } from './ast.mts'

export function getConfiguredPropertyName(
  node: ts.Node,
  names: ReadonlySet<string>,
): string | undefined {
  let name: string | undefined
  if (ts.isPropertyAssignment(node)) {
    name = getPropertyNameText(node.name)
    if (name === undefined && ts.isComputedPropertyName(node.name))
      name = getStringLiteralValue(node.name.expression)
  } else if (ts.isShorthandPropertyAssignment(node)) name = node.name.text
  else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) name = node.name.text
  return name && names.has(name) ? name : undefined
}

export function spreadMayOverrideConfiguredProperty(
  member: ts.SpreadAssignment | ts.JsxSpreadAttribute,
  names: ReadonlySet<string>,
): boolean {
  const expression = unwrapExpression(member.expression)
  if (!ts.isObjectLiteralExpression(expression)) return true
  return expression.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) return true
    if (ts.isComputedPropertyName(property.name)) {
      const name = getStringLiteralValue(property.name.expression)
      return name === undefined || names.has(name)
    }
    const name = getPropertyNameText(property.name)
    return name !== undefined && names.has(name)
  })
}
