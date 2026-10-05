import ts from '@typescript/typescript6'
import { getStringLiteralValue, unwrapExpression } from './ast.mts'
import {
  getConfiguredPropertyName,
  isConfiguredPropertyName,
  spreadMayOverrideConfiguredProperty,
} from './create-page-properties.mts'

export function visitCreatePageObject(
  node: ts.ObjectLiteralExpression | ts.JsxAttributes,
  names: ReadonlySet<string>,
  ignoredProperties: ReadonlySet<string>,
  file: string,
  visit: (node: ts.Node, ignoredProperties?: ReadonlySet<string>) => void,
): void {
  let configuredBeforeSpread = false
  for (const member of node.properties) {
    if (ts.isSpreadAssignment(member) || ts.isJsxSpreadAttribute(member)) {
      if (configuredBeforeSpread && spreadMayOverrideConfiguredProperty(member, names))
        throw new Error(`${file}: create page type can be overridden by a trailing spread`)
    } else if (
      ts.isPropertyAssignment(member) &&
      getConfiguredPropertyName(member, names) === '__proto__' &&
      !ts.isComputedPropertyName(member.name)
    ) {
      throw new Error(`${file}: create page __proto__ prototype setter is uninspectable`)
    } else if (getConfiguredPropertyName(member, names) !== undefined) {
      configuredBeforeSpread = true
    } else if (
      ts.isPropertyAssignment(member) &&
      ts.isComputedPropertyName(member.name) &&
      getStringLiteralValue(member.name.expression) === undefined &&
      configuredBeforeSpread
    ) {
      throw new Error(`${file}: create page type can be overridden by a trailing computed property`)
    }
  }
  for (let index = 0; index < node.properties.length; index += 1) {
    const member = node.properties[index]!
    if (ts.isSpreadAssignment(member) || ts.isJsxSpreadAttribute(member)) {
      const overridden = new Set<string>()
      const expression = unwrapExpression(member.expression)
      if (ts.isObjectLiteralExpression(expression)) {
        for (const later of node.properties.slice(index + 1)) {
          const name = getConfiguredPropertyName(later, names)
          if (isConfiguredPropertyName(name, names)) overridden.add(name)
        }
      }
      visit(expression, overridden)
    } else {
      const name = getConfiguredPropertyName(member, names)
      if (isConfiguredPropertyName(name, names) && ignoredProperties.has(name)) continue
      visit(member, ignoredProperties)
    }
  }
}
