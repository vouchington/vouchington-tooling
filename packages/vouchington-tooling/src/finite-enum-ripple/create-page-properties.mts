import ts from '@typescript/typescript6'
import { getPropertyNameText, getStringLiteralValue } from './ast.mts'

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
