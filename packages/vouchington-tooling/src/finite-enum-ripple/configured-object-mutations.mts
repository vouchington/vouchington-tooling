import ts from '@typescript/typescript6'
import { resolve } from 'node:path'
import { unwrapExpression } from './ast.mts'

export function hasPostDeclarationConfiguredObjectMutation(
  content: string,
  file: string,
  name: string,
  objectEnd: number,
): boolean {
  const fileName = resolve(file)
  const scriptKind =
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKind)
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = () => source
  const program = ts.createProgram([fileName], options, host)
  const checker = program.getTypeChecker()
  const findDeclaration = (node: ts.Node): ts.Identifier | undefined => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isObjectLiteralExpression(unwrapExpression(node.initializer)) &&
      unwrapExpression(node.initializer).end === objectEnd
    )
      return node.name
    return ts.forEachChild(node, findDeclaration)
  }
  // The public parser has already verified this exact const object declaration.
  const configuredName = findDeclaration(source)!
  const configuredSymbol = checker.getSymbolAtLocation(configuredName)!
  const targetsConfiguredMap = (target: ts.Expression): boolean => {
    let root = unwrapExpression(target)
    while (ts.isPropertyAccessExpression(root) || ts.isElementAccessExpression(root))
      root = unwrapExpression(root.expression)
    return ts.isIdentifier(root) && checker.getSymbolAtLocation(root) === configuredSymbol
  }
  const destructuringTargetMutatesConfiguredMap = (target: ts.Expression): boolean => {
    const expression = unwrapExpression(target)
    if (targetsConfiguredMap(expression)) return true
    if (ts.isObjectLiteralExpression(expression))
      return expression.properties.some((property) =>
        ts.isPropertyAssignment(property)
          ? destructuringTargetMutatesConfiguredMap(property.initializer)
          : ts.isShorthandPropertyAssignment(property)
            ? checker.getSymbolAtLocation(property.name) === configuredSymbol
            : ts.isSpreadAssignment(property) &&
              destructuringTargetMutatesConfiguredMap(property.expression),
      )
    if (ts.isArrayLiteralExpression(expression))
      return expression.elements.some(
        (element) =>
          !ts.isOmittedExpression(element) && destructuringTargetMutatesConfiguredMap(element),
      )
    return false
  }
  let mutated = false
  const inspect = (node: ts.Node): void => {
    if (mutated || node.end <= objectEnd) return
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        (node.operatorToken.kind >= ts.SyntaxKind.FirstCompoundAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastCompoundAssignment)) &&
      destructuringTargetMutatesConfiguredMap(node.left)
    ) {
      mutated = true
      return
    }
    if (ts.isDeleteExpression(node) && targetsConfiguredMap(node.expression)) {
      mutated = true
      return
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      targetsConfiguredMap(node.operand)
    ) {
      mutated = true
      return
    }
    ts.forEachChild(node, inspect)
  }
  inspect(source)
  return mutated
}
