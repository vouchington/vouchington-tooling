import { basename, dirname, resolve as resolvePath } from 'node:path'
import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

const standardLibrary = dirname(resolvePath(ts.getDefaultLibFilePath({})))
const compilerLibraries = new WeakMap<ts.TypeChecker, ReadonlySet<ts.SourceFile>>()

/** Records the actual caller compiler's library identities, including another installation. */
export function registerPlatformCompilerLibraries(program: ts.Program): void {
  const checker = program.getTypeChecker()
  if (!compilerLibraries.has(checker))
    compilerLibraries.set(
      checker,
      new Set(program.getSourceFiles().filter((file) => program.isSourceFileDefaultLibrary(file))),
    )
}

function standardDeclaration(
  declaration: ts.Declaration,
  timer: boolean,
  checker: ts.TypeChecker,
): boolean {
  const source = declaration.getSourceFile()
  if (!source.isDeclarationFile) return false
  const file = resolvePath(source.fileName)
  const libraries = compilerLibraries.get(checker)
  if (
    libraries
      ? libraries.has(source)
      : dirname(file) === standardLibrary && /^lib(?:\.[\w.-]+)?\.d\.ts$/.test(basename(file))
  )
    return true
  return (
    timer &&
    /\/node_modules\/@types\/node\/(?:web-globals\/)?timers\.d\.ts$/.test(
      file.replaceAll('\\', '/'),
    )
  )
}

function platformSymbol(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  seen = new Set<ts.Symbol>(),
): ts.Symbol | undefined {
  const value = unwrapExpression(expression)
  if (!ts.isIdentifier(value)) return undefined
  const symbol = checker.getSymbolAtLocation(value)
  if (!symbol || seen.has(symbol)) return undefined
  seen.add(symbol)
  if (symbol.flags & ts.SymbolFlags.Alias) {
    const target = checker.getAliasedSymbol(symbol)
    if (seen.has(target)) return undefined
    return target
  }
  const declaration = symbol.valueDeclaration
  if (
    declaration &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    ts.isVariableDeclarationList(declaration.parent) &&
    declaration.parent.flags & ts.NodeFlags.Const
  )
    return platformSymbol(declaration.initializer, checker, seen)
  return symbol
}

/** Recognizes only callback APIs supplied by the compiler's standard libraries or Node typings. */
export function platformCallbackArgument(
  node: ts.CallExpression | ts.NewExpression,
  checker: ts.TypeChecker,
): ts.Expression | undefined {
  if (ts.isCallExpression(node) && node.questionDotToken) return undefined
  const argument = node.arguments?.[0]
  if (!argument || ts.isSpreadElement(argument)) return undefined
  const symbol = platformSymbol(node.expression, checker)
  if (!symbol?.declarations?.length) return undefined
  const timer = symbol.name === 'setInterval' || symbol.name === 'setTimeout'
  if (!(timer ? ts.isCallExpression(node) : symbol.name === 'Promise' && ts.isNewExpression(node)))
    return undefined
  return symbol.declarations.every((declaration) =>
    standardDeclaration(declaration, timer, checker),
  )
    ? argument
    : undefined
}
