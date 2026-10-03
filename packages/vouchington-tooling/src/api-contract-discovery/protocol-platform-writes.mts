import { basename, dirname, resolve as resolvePath } from 'node:path'
import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

const standardLibrary = dirname(resolvePath(ts.getDefaultLibFilePath({})))
const platformNames = ['setTimeout', 'setInterval', 'Promise']

function isStandardDeclaration(
  declaration: ts.Declaration,
  libraries?: ReadonlySet<ts.SourceFile>,
) {
  const source = declaration.getSourceFile()
  const file = resolvePath(source.fileName)
  return libraries
    ? libraries.has(source)
    : source.isDeclarationFile &&
        dirname(file) === standardLibrary &&
        /^lib(?:\.[\w.-]+)?\.d\.ts$/.test(basename(file))
}

function literalStrings(
  expression: ts.Expression | undefined,
  checker: ts.TypeChecker,
): readonly string[] | undefined {
  if (!expression) return undefined
  const strings = new Set<string>()
  function visit(type: ts.Type): boolean {
    if (type.isUnion()) return type.types.every(visit)
    if (type.flags & ts.TypeFlags.StringLiteral) {
      strings.add((type as ts.StringLiteralType).value)
      return true
    }
    if (
      type.flags &
      (ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)
    )
      return false
    return true
  }
  return visit(checker.getTypeAtLocation(expression)) ? [...strings] : undefined
}

function globalTarget(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): ts.Expression | undefined {
  const value = unwrapExpression(expression)
  if (!ts.isIdentifier(value)) return undefined
  const symbol = checker.getSymbolAtLocation(value)
  if (!symbol || seen.has(symbol)) return undefined
  seen.add(symbol)
  if (value.text === 'globalThis') return symbol.declarations?.length ? undefined : value
  const declaration = symbol.valueDeclaration
  return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
    ? globalTarget(declaration.initializer, checker, seen)
    : undefined
}

function mutatorKind(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  libraries: ReadonlySet<ts.SourceFile> | undefined,
): 'defineProperty' | 'set' | 'assign' | undefined {
  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression))
    return undefined
  const owner = callee.expression.text
  const method = callee.name.text
  if (
    !(
      (owner === 'Object' && ['defineProperty', 'assign'].includes(method)) ||
      (owner === 'Reflect' && method === 'set')
    )
  )
    return undefined
  const ownerSymbol = checker.getSymbolAtLocation(callee.expression)
  const methodSymbol = checker.getSymbolAtLocation(callee.name)
  if (
    !ownerSymbol?.declarations?.length ||
    !methodSymbol?.declarations?.length ||
    !ownerSymbol.declarations.every((declaration) =>
      isStandardDeclaration(declaration, libraries),
    ) ||
    !methodSymbol.declarations.every((declaration) => isStandardDeclaration(declaration, libraries))
  )
    return undefined
  return method as 'defineProperty' | 'set' | 'assign'
}

function sourceKeys(source: ts.Expression, checker: ts.TypeChecker): readonly string[] | undefined {
  const keys = new Set<string>()
  function visit(type: ts.Type): boolean {
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter))
      return false
    if (type.isUnion()) return type.types.every(visit)
    if (type.getStringIndexType()) return false
    for (const property of type.getProperties()) keys.add(property.name)
    return true
  }
  return visit(checker.getTypeAtLocation(unwrapExpression(source))) ? [...keys] : undefined
}

/** Records global timer and Promise writes, including calls to standard property mutators. */
export function writtenPlatformSymbols(
  files: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
  libraries?: ReadonlySet<ts.SourceFile>,
): Set<ts.Symbol> {
  const written = new Set<ts.Symbol>()
  function mark(target: ts.Expression, keys: readonly string[] | undefined) {
    const root = globalTarget(target, checker)
    if (!root) return
    const members = keys
      ? keys.map((key) => checker.getPropertyOfType(checker.getTypeAtLocation(root), key))
      : platformNames.map((name) =>
          checker.getPropertyOfType(checker.getTypeAtLocation(root), name),
        )
    for (const member of members)
      if (member && platformNames.includes(member.name)) written.add(member)
  }
  function target(node: ts.Node) {
    if (ts.isElementAccessExpression(node)) {
      const keys = literalStrings(node.argumentExpression, checker)
      mark(node.expression, keys)
      return
    }
    if (ts.isPropertyAccessExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node.name)
      if (globalTarget(node.expression, checker) && symbol && platformNames.includes(symbol.name))
        written.add(symbol)
      return
    }
    const symbol = checker.getSymbolAtLocation(node)
    if (symbol && platformNames.includes(symbol.name)) written.add(symbol)
    if (
      ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isSpreadAssignment(node) ||
      ts.isSpreadElement(node)
    )
      ts.forEachChild(node, target)
  }
  function visit(node: ts.Node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      target(node.left)
    if (ts.isDeleteExpression(node)) target(node.expression)
    if (ts.isCallExpression(node)) {
      const kind = mutatorKind(node, checker, libraries)
      if (kind && node.arguments[0] && ts.isSpreadElement(node.arguments[0]))
        for (const file of files)
          for (const binding of checker.getSymbolsInScope(
            file,
            ts.SymbolFlags.Value | ts.SymbolFlags.Alias,
          )) {
            const symbol =
              binding.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(binding) : binding
            if (platformNames.includes(symbol.name)) written.add(symbol)
          }
      if (kind === 'defineProperty' || kind === 'set') {
        const receiver = node.arguments[0]
        if (receiver && !ts.isSpreadElement(receiver))
          mark(
            receiver,
            literalStrings(
              node.arguments[1] && !ts.isSpreadElement(node.arguments[1])
                ? node.arguments[1]
                : undefined,
              checker,
            ),
          )
      } else if (kind === 'assign') {
        const receiver = node.arguments[0]
        if (receiver && !ts.isSpreadElement(receiver) && globalTarget(receiver, checker)) {
          for (const source of node.arguments.slice(1)) {
            if (ts.isSpreadElement(source)) {
              const values = unwrapExpression(source.expression)
              if (ts.isArrayLiteralExpression(values)) {
                for (const value of values.elements)
                  if (ts.isSpreadElement(value)) mark(receiver, undefined)
                  else mark(receiver, sourceKeys(value, checker))
              } else mark(receiver, undefined)
            } else mark(receiver, sourceKeys(source, checker))
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  for (const file of files) if (!file.isDeclarationFile) visit(file)
  return written
}
