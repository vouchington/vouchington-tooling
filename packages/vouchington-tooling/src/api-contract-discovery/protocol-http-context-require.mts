import { resolve } from 'node:path'
import ts from '../contract-schema/typescript-api.mts'

/** Literal standard Node require calls resolve only to files in this actual Program. */
export function createContextRequiredModule(
  checker: ts.TypeChecker,
  sources?: readonly ts.SourceFile[],
  options: ts.CompilerOptions = {},
) {
  const cache = new Map<ts.CallExpression, ts.Symbol | undefined>()
  let files: Map<string, ts.SourceFile> | undefined
  let host: ts.ModuleResolutionHost | undefined
  return (node: ts.Expression): ts.Symbol | undefined => {
    if (
      !sources ||
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== 'require' ||
      node.arguments.length !== 1 ||
      !ts.isStringLiteral(node.arguments[0]!)
    )
      return undefined
    const binding = checker.getSymbolAtLocation(node.expression)
    if (
      !binding?.declarations?.length ||
      !binding.declarations.every(
        (declaration) =>
          declaration.getSourceFile().isDeclarationFile &&
          declaration
            .getSourceFile()
            .fileName.replaceAll('\\', '/')
            .endsWith('/node_modules/@types/node/module.d.ts'),
      )
    )
      return undefined
    if (cache.has(node)) return cache.get(node)
    files ??= new Map(sources.map((file) => [resolve(file.fileName), file]))
    host ??= {
      fileExists: (name) => files!.has(resolve(name)),
      readFile: (name) => files!.get(resolve(name))?.text,
    }
    const resolved = ts.resolveModuleName(
      node.arguments[0]!.text,
      node.getSourceFile().fileName,
      options,
      host,
    ).resolvedModule
    const source = resolved && files.get(resolve(resolved.resolvedFileName))
    const module = source && checker.getSymbolAtLocation(source)
    cache.set(node, module)
    return module
  }
}
