import ts from '@typescript/typescript6'

export function collectCallExpressions(content: string, file: string): ts.CallExpression[] {
  const sourceFile = createSourceFile(content, file)
  const calls: ts.CallExpression[] = []
  walkAst(sourceFile, (node) => {
    if (ts.isCallExpression(node)) calls.push(node)
  })
  return calls
}

export function findConstObjectLiteral(
  content: string,
  name: string,
  file: string,
): ts.ObjectLiteralExpression {
  const sourceFile = createSourceFile(content, file)
  const declaration = findConstVariableDeclaration(sourceFile, name)
  if (!declaration) throw new Error(`${file}: could not find ${name}`)
  const initializer = declaration.initializer && unwrapExpression(declaration.initializer)
  if (!initializer || !ts.isObjectLiteralExpression(initializer))
    throw new Error(`${file}: could not find ${name}`)
  if (!initializer.getText(sourceFile).trimEnd().endsWith('}'))
    throw new Error(`${file}: could not find end of ${name}`)
  return initializer
}

export function findTypeAliasDeclaration(
  content: string,
  name: string,
  file: string,
): ts.TypeAliasDeclaration {
  const sourceFile = createSourceFile(content, file)
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === name) return statement
  }
  throw new Error(`${file}: could not parse ${name} union`)
}

export function getCallExpressionName(expression: ts.Expression): string | undefined {
  const node = unwrapExpression(expression)
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  return undefined
}

export function getPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteral(name)) return name.text
  if (ts.isNumericLiteral(name)) return name.text
  return undefined
}

export function getStringLiteralValue(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined
  const value = unwrapExpression(node)
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text
  return undefined
}

export function unwrapExpression<T extends ts.Node>(node: T): T {
  let current: ts.Node = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current as T
}

function walkAst(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node)
  ts.forEachChild(node, (child) => walkAst(child, onNode))
}

function createSourceFile(content: string, file: string): ts.SourceFile {
  const scriptKind =
    file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind)
}

function findConstVariableDeclaration(sourceFile: ts.SourceFile, name: string) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration
    }
  }
  return undefined
}
