import { basename, dirname, resolve as resolvePath } from 'node:path'
import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

const standardLibrary = dirname(resolvePath(ts.getDefaultLibFilePath({})))

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

export function literalStrings(
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

export function globalTarget(
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

export function mutatorKind(
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

export function sourceKeys(
  source: ts.Expression,
  checker: ts.TypeChecker,
): readonly string[] | undefined {
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
