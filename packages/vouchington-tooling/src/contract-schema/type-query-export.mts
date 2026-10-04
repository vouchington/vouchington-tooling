import ts from './typescript-api.mts'

export interface ExportedTypeSelector {
  readonly fileName: string
  readonly exportName: string
}

export function sourceFileForQuery(program: ts.Program, fileName: string): ts.SourceFile {
  const sourceFile = program.getSourceFile(fileName)
  if (!sourceFile) throw new Error(`Type-query source file "${fileName}" is not in the program`)
  return sourceFile
}

function exportedSymbol(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  exportName: string,
): ts.Symbol {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  const exported =
    moduleSymbol &&
    checker.getExportsOfModule(moduleSymbol).find((candidate) => candidate.name === exportName)
  if (!exported) {
    throw new Error(`Missing export "${exportName}" in "${sourceFile.fileName}"`)
  }
  return exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
}

export function exportedType(
  program: ts.Program,
  checker: ts.TypeChecker,
  selector: ExportedTypeSelector,
): ts.Type {
  const sourceFile = sourceFileForQuery(program, selector.fileName)
  const symbol = exportedSymbol(checker, sourceFile, selector.exportName)
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
  if (!declaration) {
    throw new Error(
      `Export "${selector.exportName}" in "${selector.fileName}" could not be resolved to a declaration`,
    )
  }
  if (symbol.flags & ts.SymbolFlags.Type) return checker.getDeclaredTypeOfSymbol(symbol)
  return checker.getTypeOfSymbolAtLocation(symbol, declaration)
}

export function exportedDefaultType(
  program: ts.Program,
  checker: ts.TypeChecker,
  selector: ExportedTypeSelector,
  parameterIndex: number,
): ts.Type {
  const sourceFile = sourceFileForQuery(program, selector.fileName)
  const symbol = exportedSymbol(checker, sourceFile, selector.exportName)
  const directParameters = symbol.declarations
    ?.map(
      (declaration) =>
        (
          declaration as ts.Declaration & {
            typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>
          }
        ).typeParameters,
    )
    .find((parameters) => parameters?.[parameterIndex]?.default)
  const signatureParameters = exportedType(program, checker, selector)
    .getCallSignatures()[0]
    ?.getDeclaration()?.typeParameters
  const parameters = directParameters ?? signatureParameters
  const defaultNode = parameters?.[parameterIndex]?.default
  if (!defaultNode) {
    throw new Error(
      `Missing default for type parameter ${parameterIndex} of export "${selector.exportName}" in "${selector.fileName}"`,
    )
  }
  if (ts.isTypeReferenceNode(defaultNode) && ts.isIdentifier(defaultNode.typeName)) {
    const referencedName = defaultNode.typeName.text
    const previousIndex = parameters?.findIndex(
      (parameter, index) => index < parameterIndex && parameter.name.text === referencedName,
    )
    if (previousIndex !== undefined && previousIndex >= 0 && parameters?.[previousIndex]?.default) {
      return exportedDefaultType(program, checker, selector, previousIndex)
    }
  }
  return checker.getTypeAtLocation(defaultNode)
}
