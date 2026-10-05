import type ts from './typescript-api.mts'

import type { TypeScriptApi } from './type-query-api.mts'

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
  typescript: TypeScriptApi,
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
  return exported.flags & typescript.SymbolFlags.Alias
    ? checker.getAliasedSymbol(exported)
    : exported
}

export function exportedType(
  typescript: TypeScriptApi,
  program: ts.Program,
  checker: ts.TypeChecker,
  selector: ExportedTypeSelector,
): ts.Type {
  const sourceFile = sourceFileForQuery(program, selector.fileName)
  const symbol = exportedSymbol(typescript, checker, sourceFile, selector.exportName)
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
  if (!declaration) {
    throw new Error(
      `Export "${selector.exportName}" in "${selector.fileName}" could not be resolved to a declaration`,
    )
  }
  if (symbol.flags & typescript.SymbolFlags.Type) return checker.getDeclaredTypeOfSymbol(symbol)
  return checker.getTypeOfSymbolAtLocation(symbol, declaration)
}

export function exportedAssignableType(
  typescript: TypeScriptApi,
  program: ts.Program,
  checker: ts.TypeChecker,
  selector: ExportedTypeSelector,
): ts.Type {
  const sourceFile = sourceFileForQuery(program, selector.fileName)
  const symbol = exportedSymbol(typescript, checker, sourceFile, selector.exportName)
  const genericDeclaration = symbol.declarations?.some((declaration) => {
    const isGenericTypeDeclaration =
      typescript.isClassDeclaration(declaration) ||
      typescript.isInterfaceDeclaration(declaration) ||
      typescript.isTypeAliasDeclaration(declaration)
    return (
      isGenericTypeDeclaration &&
      Boolean(
        (
          declaration as ts.Declaration & {
            typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration>
          }
        ).typeParameters?.length,
      )
    )
  })
  const type = exportedType(typescript, program, checker, selector)
  const defaultedSignature = [...type.getCallSignatures(), ...type.getConstructSignatures()].some(
    (signature) =>
      signature.getDeclaration()?.typeParameters?.some((parameter) => parameter.default),
  )
  if (
    genericDeclaration ||
    (!(symbol.flags & typescript.SymbolFlags.Value) && defaultedSignature)
  ) {
    throw new Error(
      `Assignable target "${selector.exportName}" in "${selector.fileName}" has generic or defaulted type parameters; export and select a named instantiated type instead`,
    )
  }
  return type
}

export function exportedDefaultType(
  typescript: TypeScriptApi,
  program: ts.Program,
  checker: ts.TypeChecker,
  selector: ExportedTypeSelector,
  parameterIndex: number,
): ts.Type {
  const sourceFile = sourceFileForQuery(program, selector.fileName)
  const symbol = exportedSymbol(typescript, checker, sourceFile, selector.exportName)
  const directDeclaration = symbol.declarations?.find(
    (declaration) =>
      !typescript.isFunctionDeclaration(declaration) &&
      (typescript.isClassDeclaration(declaration) ||
        typescript.isInterfaceDeclaration(declaration) ||
        typescript.isTypeAliasDeclaration(declaration)),
  )
  const directParameters = (
    directDeclaration as
      | (ts.Declaration & { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> })
      | undefined
  )?.typeParameters
  const type = exportedType(typescript, program, checker, selector)
  const signatureParameters = [
    ...type.getCallSignatures(),
    ...type.getConstructSignatures(),
  ][0]?.getDeclaration()?.typeParameters
  const parameters = directParameters !== undefined ? directParameters : signatureParameters
  const defaultNode = parameters?.[parameterIndex]?.default
  if (!defaultNode) {
    throw new Error(
      `Missing default for type parameter ${parameterIndex} of export "${selector.exportName}" in "${selector.fileName}"`,
    )
  }
  if (
    typescript.isTypeReferenceNode(defaultNode) &&
    typescript.isIdentifier(defaultNode.typeName)
  ) {
    const referencedName = defaultNode.typeName.text
    const previousIndex = parameters?.findIndex(
      (parameter, index) => index < parameterIndex && parameter.name.text === referencedName,
    )
    if (previousIndex !== undefined && previousIndex >= 0 && parameters?.[previousIndex]?.default) {
      return exportedDefaultType(typescript, program, checker, selector, previousIndex)
    }
  }
  const previousSymbols = new Set(
    parameters
      ?.slice(0, parameterIndex)
      .map((parameter) => checker.getSymbolAtLocation(parameter.name))
      .filter((symbol): symbol is ts.Symbol => symbol !== undefined),
  )
  let hasDependentReference = false
  function visit(node: ts.Node): void {
    const symbol = typescript.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined
    if (symbol && previousSymbols.has(symbol)) {
      hasDependentReference = true
      return
    }
    typescript.forEachChild(node, visit)
  }
  visit(defaultNode)
  if (hasDependentReference) {
    throw new Error(
      `Unsupported dependent composite default for type parameter ${parameterIndex} of export "${selector.exportName}" in "${selector.fileName}"; export and query a named instantiated type instead`,
    )
  }
  return checker.getTypeAtLocation(defaultNode)
}
