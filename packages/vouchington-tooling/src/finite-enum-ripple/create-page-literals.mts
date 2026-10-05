import ts from '@typescript/typescript6'
import { getStringLiteralValue, unwrapExpression } from './ast.mts'
import { jsxRuntimeStringValue } from './create-page-jsx.mts'
import {
  getConfiguredPropertyName,
  spreadMayOverrideConfiguredProperty,
} from './create-page-properties.mts'

/** Inspect syntax nodes so comments and strings containing example code are ignored. */
export function collectCreatePageLiterals(
  content: string,
  file: string,
  properties: readonly string[],
): string[] {
  const scriptKind =
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind)
  const names = new Set(properties)
  const values: string[] = []
  const visit = (node: ts.Node, ignoredProperties: ReadonlySet<string> = new Set()): void => {
    if (ts.isObjectLiteralExpression(node) || ts.isJsxAttributes(node)) {
      let configuredBeforeSpread = false
      for (const member of node.properties) {
        if (ts.isSpreadAssignment(member) || ts.isJsxSpreadAttribute(member)) {
          if (configuredBeforeSpread && spreadMayOverrideConfiguredProperty(member, names))
            throw new Error(`${file}: create page type can be overridden by a trailing spread`)
        } else if (getConfiguredPropertyName(member, names) !== undefined) {
          configuredBeforeSpread = true
        } else if (
          ts.isPropertyAssignment(member) &&
          ts.isComputedPropertyName(member.name) &&
          getStringLiteralValue(member.name.expression) === undefined &&
          configuredBeforeSpread
        ) {
          throw new Error(
            `${file}: create page type can be overridden by a trailing computed property`,
          )
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
              if (name && names.has(name)) overridden.add(name)
            }
          }
          visit(expression, overridden)
        } else {
          visit(member, ignoredProperties)
        }
      }
      return
    }
    if (ts.isPropertyAssignment(node)) {
      const name = getConfiguredPropertyName(node, names)
      if (name && !ignoredProperties.has(name)) {
        const value = getStringLiteralValue(node.initializer)
        if (value === undefined)
          throw new Error(`${file}: create page ${name} must be a string literal`)
        values.push(value)
      }
      ts.forEachChild(node, (child) => visit(child, new Set()))
      return
    } else if (ts.isShorthandPropertyAssignment(node) && names.has(node.name.text)) {
      throw new Error(`${file}: create page ${node.name.text} must be a string literal`)
    } else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
      const value =
        node.initializer && ts.isJsxExpression(node.initializer)
          ? getStringLiteralValue(node.initializer.expression)
          : node.initializer && ts.isStringLiteral(node.initializer)
            ? jsxRuntimeStringValue(node.initializer, source, file)
            : getStringLiteralValue(node.initializer)
      if (value === undefined)
        throw new Error(`${file}: create page ${node.name.text} must be a string literal`)
      values.push(value)
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = unwrapExpression(node.left)
      const name = ts.isIdentifier(left)
        ? left.text
        : ts.isPropertyAccessExpression(left)
          ? left.name.text
          : ts.isElementAccessExpression(left)
            ? getStringLiteralValue(left.argumentExpression)
            : undefined
      const value = getStringLiteralValue(node.right)
      if (name && names.has(name) && value === undefined)
        throw new Error(`${file}: create page ${name} must be a string literal`)
      if (name && names.has(name) && value !== undefined) values.push(value)
    }
    ts.forEachChild(node, (child) => visit(child))
  }
  visit(source)
  return values
}
