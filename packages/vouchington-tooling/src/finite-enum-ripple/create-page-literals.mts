import ts from '@typescript/typescript6'
import { getPropertyNameText, getStringLiteralValue } from './ast.mts'

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
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) || ts.isJsxAttributes(node)) {
      let configuredBeforeSpread = false
      for (const member of node.properties) {
        if (ts.isSpreadAssignment(member) || ts.isJsxSpreadAttribute(member)) {
          if (configuredBeforeSpread)
            throw new Error(`${file}: create page type can be overridden by a trailing spread`)
        } else if (
          (ts.isPropertyAssignment(member) && names.has(getPropertyNameText(member.name) ?? '')) ||
          (ts.isJsxAttribute(member) && ts.isIdentifier(member.name) && names.has(member.name.text))
        ) {
          configuredBeforeSpread = true
        }
      }
    }
    if (ts.isPropertyAssignment(node) && getPropertyNameText(node.name)) {
      const name = getPropertyNameText(node.name)!
      const value = getStringLiteralValue(node.initializer)
      if (names.has(name) && value === undefined)
        throw new Error(`${file}: create page ${name} must be a string literal`)
      if (names.has(name) && value !== undefined) values.push(value)
    } else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
      const value =
        node.initializer && ts.isJsxExpression(node.initializer)
          ? getStringLiteralValue(node.initializer.expression)
          : getStringLiteralValue(node.initializer)
      if (value === undefined)
        throw new Error(`${file}: create page ${node.name.text} must be a string literal`)
      values.push(value)
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const name = ts.isIdentifier(node.left)
        ? node.left.text
        : ts.isPropertyAccessExpression(node.left)
          ? node.left.name.text
          : ts.isElementAccessExpression(node.left)
            ? getStringLiteralValue(node.left.argumentExpression)
            : undefined
      const value = getStringLiteralValue(node.right)
      if (name && names.has(name) && value === undefined)
        throw new Error(`${file}: create page ${name} must be a string literal`)
      if (name && names.has(name) && value !== undefined) values.push(value)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return values
}
