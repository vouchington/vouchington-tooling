import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { literalStrings } from './protocol-platform-mutation-targets.mts'

const contexts = new WeakMap<
  ts.TypeChecker,
  { files: readonly ts.SourceFile[]; replaced?: boolean }
>()

/** Keep actual caller Program identity; inspect Node exports only when freshness needs it. */
export function registerSseNodeConstructorContext(program: ts.Program): void {
  const checker = program.getTypeChecker()
  if (!contexts.has(checker)) contexts.set(checker, { files: program.getSourceFiles() })
}

function constantInitializer(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.Expression | undefined {
  const value = unwrapExpression(expression)
  if (!ts.isIdentifier(value)) return undefined
  const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration
  return declaration &&
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.flags & ts.NodeFlags.Const
    ? declaration.initializer
    : undefined
}

function nodeModuleApi(expression: ts.Expression, name: string, checker: ts.TypeChecker): boolean {
  const value = unwrapExpression(expression)
  if (!ts.isIdentifier(value)) return false
  const declaration = checker.getSymbolAtLocation(value)?.declarations?.[0]
  if (!declaration || !ts.isImportSpecifier(declaration)) return false
  const imported = declaration.parent.parent.parent
  return (
    ts.isImportDeclaration(imported) &&
    ts.isStringLiteral(imported.moduleSpecifier) &&
    ['node:module', 'module'].includes(imported.moduleSpecifier.text) &&
    (declaration.propertyName?.text ?? declaration.name.text) === name
  )
}

function requiredStream(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Expression>(),
): boolean {
  const value = unwrapExpression(expression)
  if (seen.has(value)) return false
  seen.add(value)
  const initializer = constantInitializer(value, checker)
  if (initializer) return requiredStream(initializer, checker, seen)
  if (!ts.isCallExpression(value)) return false
  const argument = value.arguments[0]
  if (
    argument &&
    ts.isStringLiteral(argument) &&
    !['node:stream', 'stream'].includes(argument.text)
  )
    return false
  let require = unwrapExpression(value.expression)
  const aliases = new Set<ts.Expression>()
  while (!aliases.has(require)) {
    aliases.add(require)
    const alias = constantInitializer(require, checker)
    if (!alias) break
    require = unwrapExpression(alias)
  }
  return ts.isCallExpression(require) && nodeModuleApi(require.expression, 'createRequire', checker)
}

/** Synced CommonJS replacements invalidate the named ESM constructor's allocation identity. */
export function nodePassThroughUnmodified(source: ts.SourceFile, checker: ts.TypeChecker): boolean {
  const context = contexts.get(checker)
  if (context?.replaced !== undefined) return !context.replaced
  let synced = false
  let mutated = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      nodeModuleApi(node.expression, 'syncBuiltinESMExports', checker)
    )
      synced = true
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const target = unwrapExpression(node.left)
      if (
        (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) &&
        requiredStream(target.expression, checker)
      ) {
        const keys = ts.isPropertyAccessExpression(target)
          ? [target.name.text]
          : literalStrings(target.argumentExpression, checker)
        if (!keys || keys.includes('PassThrough')) mutated = true
      }
    }
    node.forEachChild(visit)
  }
  for (const file of context?.files ?? [source]) if (!file.isDeclarationFile) visit(file)
  if (context) context.replaced = synced && mutated
  return !(synced && mutated)
}
