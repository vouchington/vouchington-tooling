import ts from '../../contract-schema/typescript-api.mts'
import {
  simpleName,
  unparenthesized,
  walk,
  type ReaderSqlTemplateOptions,
} from './sql-template.mts'

export function terminalSqlExecutorBindings(
  ast: ts.SourceFile,
  options: ReaderSqlTemplateOptions,
): Set<string> {
  const bindings = new Set<string>()
  walk(ast, (node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return
    const names = options.executorImports.get(node.moduleSpecifier.text)
    const specifiers = node.importClause?.namedBindings
    if (!names || !specifiers || !ts.isNamedImports(specifiers)) return
    for (const specifier of specifiers.elements) {
      if (names.has((specifier.propertyName ?? specifier.name).text))
        bindings.add(specifier.name.text)
    }
  })
  walk(ast, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return
    const initializer = node.initializer && unparenthesized(node.initializer)
    if (!initializer || !ts.isConditionalExpression(initializer)) return
    const consequent = simpleName(initializer.whenTrue)
    const alternate = simpleName(initializer.whenFalse)
    if ((consequent && bindings.has(consequent)) || (alternate && bindings.has(alternate)))
      bindings.add(node.name.text)
  })
  return bindings
}
