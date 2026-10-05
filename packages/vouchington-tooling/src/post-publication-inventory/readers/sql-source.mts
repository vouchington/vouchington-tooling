import ts from '../../contract-schema/typescript-api.mts'
import { terminalSqlExecutorBindings } from './sql-executors.mts'
import {
  identifierName,
  staticComputedPropertyName,
  staticSqlTemplateText,
  unparenthesized,
  walk,
  type ReaderSqlTemplateOptions,
} from './sql-template.mts'

/**
 * Collect static SQL fragments returned, exported, or passed to configured executors.
 * Interpolations become numbered placeholders; local append chains are reassembled.
 * This preserves name-based collection heuristics, not binding or control-flow proof.
 */
export function extractStaticSqlTemplateQuasis(
  content: string,
  options: ReaderSqlTemplateOptions,
): string[] {
  // TypeScript's source-file parser recovers from syntax errors. Reject those first,
  // preserving the previous strict parser's failure contract instead of trusting recovery.
  const result = ts.transpileModule(content, {
    fileName: 'reader.mts',
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  })
  if (result.diagnostics?.length)
    throw new SyntaxError(ts.flattenDiagnosticMessageText(result.diagnostics[0]!.messageText, '\n'))
  const ast = ts.createSourceFile('reader.mts', content, ts.ScriptTarget.Latest, true)
  const executors = terminalSqlExecutorBindings(ast, options)
  const statements = new Map<string, { text: string; offset: number }>()
  const consumed = new Set<string>()
  const direct: string[] = []
  walk(ast, (node) => {
    if (!ts.isVariableDeclaration(node)) return
    const binding = identifierName(node.name)
    const text = staticSqlTemplateText(node.initializer, options)
    if (binding && text) statements.set(binding, { text, offset: node.getStart(ast) })
  })
  walk(ast, (node) => {
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of node.declarationList.declarations) {
        const binding = identifierName(declaration.name)
        if (binding) consumed.add(binding)
      }
    }
    if (ts.isReturnStatement(node) && node.expression) {
      const binding = identifierName(node.expression)
      if (binding) consumed.add(binding)
      const text = staticSqlTemplateText(node.expression, options)
      if (text) direct.push(text)
      return
    }
    if (!ts.isCallExpression(node)) return
    const callee = unparenthesized(node.expression)
    if (!ts.isIdentifier(callee) || !executors.has(callee.text)) return
    for (const argument of node.arguments) {
      const binding = identifierName(argument)
      if (binding) consumed.add(binding)
      const text = staticSqlTemplateText(argument, options)
      if (text) direct.push(text)
    }
  })
  walk(ast, (node) => {
    if (!ts.isCallExpression(node)) return
    const callee = unparenthesized(node.expression)
    if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return
    const method = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : callee.argumentExpression
        ? staticComputedPropertyName(callee.argumentExpression)
        : undefined
    if (method !== options.appendMethod) return
    const receiver = identifierName(callee.expression)
    const statement = receiver ? statements.get(receiver) : undefined
    const appended = staticSqlTemplateText(node.arguments[0], options)
    if (statement && appended && node.getStart(ast) > statement.offset) statement.text += appended
  })
  return [
    ...direct,
    ...[...statements].flatMap(([binding, statement]) =>
      consumed.has(binding) ? [statement.text] : [],
    ),
  ]
}
