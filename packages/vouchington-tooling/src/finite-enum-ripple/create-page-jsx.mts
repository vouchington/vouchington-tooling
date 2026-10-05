import ts from '@typescript/typescript6'

import { getPropertyNameText, getStringLiteralValue } from './ast.mts'

export function jsxRuntimeStringValue(
  value: ts.StringLiteral,
  source: ts.SourceFile,
  file: string,
): string {
  const compiled = ts.transpileModule(`const element = <div action=${value.getText(source)} />`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX },
  })
  const emitted = ts.createSourceFile(file, compiled.outputText, ts.ScriptTarget.Latest, true)
  return jsxRuntimeAttributeStringValue(emitted, file)
}

export function jsxRuntimeAttributeStringValue(emitted: ts.SourceFile, file: string): string {
  let runtimeValue: string | undefined
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === '_jsx' &&
      node.arguments[1] &&
      ts.isObjectLiteralExpression(node.arguments[1])
    ) {
      const attribute = node.arguments[1].properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && getPropertyNameText(property.name) === 'action',
      )
      if (attribute) runtimeValue = getStringLiteralValue(attribute.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(emitted)
  if (runtimeValue === undefined) throw new Error(`${file}: could not decode JSX create-page value`)
  return runtimeValue
}
