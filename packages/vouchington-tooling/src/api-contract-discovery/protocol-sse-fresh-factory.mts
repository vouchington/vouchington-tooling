import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'

function trustedFactoryBinding(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): ts.FunctionDeclaration | undefined {
  const callee = unwrapExpression(call.expression)
  if (!ts.isIdentifier(callee)) return undefined
  const source = checker.getSymbolAtLocation(callee)
  if (!source) return undefined
  const target = source.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(source) : source
  const declaration = target.valueDeclaration
  return declaration &&
    ts.isFunctionDeclaration(declaration) &&
    declaration.body &&
    !symbolBindingWritten(declaration.getSourceFile(), target, checker)
    ? declaration
    : undefined
}

function returnProperty(
  expression: ts.Expression,
  propertyName: string,
  checker: ts.TypeChecker,
): ts.Expression | undefined {
  const value = unwrapExpression(expression)
  if (!ts.isObjectLiteralExpression(value)) return undefined
  let selected: ts.Expression | undefined
  for (const property of value.properties) {
    if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property))
      return undefined
    if (!ts.isIdentifier(property.name)) return undefined
    if (property.name.text !== propertyName) continue
    if (selected) return undefined
    if (ts.isPropertyAssignment(property)) {
      selected = property.initializer
      continue
    }
    const symbol = checker.getShorthandAssignmentValueSymbol(property)
    const declaration = symbol?.valueDeclaration
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name)
    )
      return undefined
    selected = declaration.name
  }
  return selected
}

function freshlyAllocated(
  expression: ts.Expression,
  factory: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
): boolean {
  const value = unwrapExpression(expression)
  if (ts.isNewExpression(value)) return freshConstructor(value, checker)
  if (!ts.isIdentifier(value)) return false
  const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration
  return (
    declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    ts.isVariableDeclarationList(declaration.parent) &&
    !!(declaration.parent.flags & ts.NodeFlags.Const) &&
    enclosingFunction(declaration) === factory &&
    declaration.initializer !== undefined &&
    ts.isNewExpression(unwrapExpression(declaration.initializer)) &&
    freshConstructor(unwrapExpression(declaration.initializer) as ts.NewExpression, checker)
  )
}

function freshConstructor(value: ts.NewExpression, checker: ts.TypeChecker): boolean {
  if (!ts.isIdentifier(value.expression)) return false
  const symbol = checker.getSymbolAtLocation(value.expression)
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
  if (declaration && ts.isImportSpecifier(declaration)) {
    let parent: ts.Node | undefined = declaration.parent
    while (parent && !ts.isImportDeclaration(parent)) parent = parent.parent
    const source = parent && parent.moduleSpecifier
    return (
      (declaration.propertyName?.text ?? declaration.name.text) === 'PassThrough' &&
      !!source &&
      ts.isStringLiteral(source) &&
      (source.text === 'node:stream' || source.text === 'stream')
    )
  }
  if (!declaration || (!ts.isClassDeclaration(declaration) && !ts.isClassExpression(declaration)))
    return false
  if (declaration.heritageClauses?.length) return false
  if (symbol && symbolBindingWritten(declaration.getSourceFile(), symbol, checker)) return false
  return !declaration.members.some(ts.isConstructorDeclaration)
}

export function symbolBindingWritten(
  source: ts.SourceFile,
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  const references = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === symbol) return true
    return node.getChildren().some(references)
  }
  let written = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      references(node.left)
    )
      written = true
    if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && references(node.initializer))
      written = true
    if (!written) node.forEachChild(visit)
  }
  visit(source)
  return written
}

/** Recognize a returned property backed by a local `new` allocation on every return path. */
export function factoryCreatesFreshSelectedStream(
  call: ts.CallExpression,
  propertyName: string,
  checker: ts.TypeChecker,
): boolean {
  const factory = trustedFactoryBinding(call, checker)
  if (!factory?.body) return false
  const returns: (ts.Expression | undefined)[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== factory) return
    if (ts.isReturnStatement(node)) {
      returns.push(node.expression)
      return
    }
    node.forEachChild(visit)
  }
  visit(factory.body)
  return (
    returns.length > 0 &&
    returns.every((expression) => {
      if (!expression) return false
      const value = returnProperty(expression, propertyName, checker)
      return value !== undefined && freshlyAllocated(value, factory, checker)
    })
  )
}
