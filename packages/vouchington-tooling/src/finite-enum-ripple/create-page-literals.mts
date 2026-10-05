import ts from '@typescript/typescript6'
import { getStringLiteralValue, unwrapExpression } from './ast.mts'
import { jsxRuntimeStringValue } from './create-page-jsx.mts'
import { getConfiguredPropertyName, isConfiguredPropertyName } from './create-page-properties.mts'
import { visitCreatePageObject } from './create-page-object-visitor.mts'

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
  const assignedPropertyName = (target: ts.Expression): string | undefined => {
    const left = unwrapExpression(target)
    return ts.isIdentifier(left)
      ? left.text
      : ts.isPropertyAccessExpression(left)
        ? left.name.text
        : ts.isElementAccessExpression(left)
          ? getStringLiteralValue(left.argumentExpression)
          : undefined
  }
  const visit = (node: ts.Node, ignoredProperties: ReadonlySet<string> = new Set()): void => {
    if (ts.isObjectLiteralExpression(node) || ts.isJsxAttributes(node)) {
      visitCreatePageObject(node, names, ignoredProperties, file, visit)
      return
    }
    if (ts.isPropertyAssignment(node)) {
      const name = getConfiguredPropertyName(node, names)
      if (isConfiguredPropertyName(name, names) && !ignoredProperties.has(name)) {
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
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      const name = assignedPropertyName(node.operand)
      if (isConfiguredPropertyName(name, names))
        throw new Error(`${file}: unary update to create page ${name} is uninspectable`)
    } else if (ts.isBinaryExpression(node)) {
      const name = assignedPropertyName(node.left)
      if (
        node.operatorToken.kind >= ts.SyntaxKind.FirstCompoundAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastCompoundAssignment &&
        isConfiguredPropertyName(name, names)
      )
        throw new Error(`${file}: compound assignment to create page ${name} is uninspectable`)
      if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
        ts.forEachChild(node, (child) => visit(child))
        return
      }
      const value = getStringLiteralValue(node.right)
      if (isConfiguredPropertyName(name, names) && value === undefined)
        throw new Error(`${file}: create page ${name} must be a string literal`)
      if (isConfiguredPropertyName(name, names) && value !== undefined) values.push(value)
    }
    ts.forEachChild(node, (child) => visit(child))
  }
  visit(source)
  return values
}
