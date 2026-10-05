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
  return name !== undefined && names.has(name) ? name : undefined
}

export function isConfiguredPropertyName(
  name: string | undefined,
  names: ReadonlySet<string>,
): name is string {
  return name !== undefined && names.has(name)
}

export function spreadMayOverrideConfiguredProperty(
  member: ts.SpreadAssignment | ts.JsxSpreadAttribute,
  names: ReadonlySet<string>,
): boolean {
  return expressionMayOverride(unwrapExpression(member.expression), names)
}

function expressionMayOverride(expression: ts.Expression, names: ReadonlySet<string>): boolean {
  if (!ts.isObjectLiteralExpression(expression)) return true
  return expression.properties.some((property) => {
    if (ts.isSpreadAssignment(property))
      return expressionMayOverride(unwrapExpression(property.expression), names)
    if (ts.isComputedPropertyName(property.name)) {
      const name = getStringLiteralValue(property.name.expression)
      return name === undefined || names.has(name)
    }
    const name = getPropertyNameText(property.name)
    return name !== undefined && names.has(name)
  })
}
