import ts from '../contract-schema/typescript-api.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'
import { functionSymbol, resolveSymbol } from './response-contract-symbols.mts'

type ExportRef = { module: string; exportName: string }

/** Resolves a callee through aliases and re-exports to the symbol it ultimately names. */
export function calleeSymbol(
  callee: ts.Expression,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const target = unwrapTransparentExpression(callee)
  const name = ts.isPropertyAccessExpression(target) ? target.name : target
  const symbol = ts.isIdentifier(name) ? checker.getSymbolAtLocation(name) : undefined
  return symbol && resolveSymbol(symbol, checker)
}

const stripExtension = (path: string) =>
  path.replace(/\.d\.[cm]?ts$/, '').replace(/\.[cm]?[jt]sx?$/, '')

function moduleMatches(fileName: string, module: string): boolean {
  const path = fileName.replaceAll('\\', '/')
  const wanted = module.replace(/^\.?\//, '')
  return (
    path.includes(`/node_modules/${module}/`) ||
    [path, stripExtension(path)].some((candidate) => candidate.endsWith(`/${wanted}`))
  )
}

/** True when the symbol is the configured export of a declaration file matching the module. */
function matchesExport(symbol: ts.Symbol, config: ExportRef, checker: ts.TypeChecker): boolean {
  return symbol.declarations!.some((declaration) => {
    const file = declaration.getSourceFile()
    if (!moduleMatches(file.fileName, config.module)) return false
    const moduleSymbol = checker.getSymbolAtLocation(file)
    const exported = moduleSymbol
      ? checker
          .getExportsOfModule(moduleSymbol)
          .find((item) => item.getName() === config.exportName)
      : undefined
    return !!exported && resolveSymbol(exported, checker) === symbol
  })
}

export function findConfig<T extends ExportRef>(
  callee: ts.Expression,
  configs: readonly T[],
  checker: ts.TypeChecker,
): T | undefined {
  const symbol = calleeSymbol(callee, checker)
  return symbol ? configs.find((config) => matchesExport(symbol, config, checker)) : undefined
}

/** True when the node sits inside the implementation of a configured export. */
export function insideConfiguredImplementation(
  node: ts.Node,
  configs: readonly ExportRef[],
  checker: ts.TypeChecker,
): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    const symbol = ts.isFunctionLike(current) ? functionSymbol(current, checker) : undefined
    if (symbol && configs.some((config) => matchesExport(symbol, config, checker))) return true
  }
  return false
}
