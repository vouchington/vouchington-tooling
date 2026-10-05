import type ts from './typescript-api.mts'

type NodePredicate<Node extends ts.Node> = {
  check(node: ts.Node): node is Node
}['check']

type ForEachChild = {
  visit(node: ts.Node, callback: (child: ts.Node) => void): void
}['visit']

export interface TypeScriptApi {
  readonly IndexKind: { readonly Number: number }
  readonly SymbolFlags: { readonly Alias: number; readonly Type: number; readonly Value: number }
  readonly SyntaxKind: { readonly SourceFile: number }
  readonly TypeFlags: { readonly Any: number; readonly Never: number }
  readonly forEachChild: ForEachChild
  readonly isClassDeclaration: NodePredicate<ts.ClassDeclaration>
  readonly isCallExpression: NodePredicate<ts.CallExpression>
  readonly isFunctionDeclaration: NodePredicate<ts.FunctionDeclaration>
  readonly isInterfaceDeclaration: NodePredicate<ts.InterfaceDeclaration>
  readonly isIdentifier: NodePredicate<ts.Identifier>
  readonly isSourceFile: NodePredicate<ts.SourceFile>
  readonly isTypeReferenceNode: NodePredicate<ts.TypeReferenceNode>
  readonly isTypeAliasDeclaration: NodePredicate<ts.TypeAliasDeclaration>
}

export interface TypeScriptProgram {
  getSourceFile(fileName: string): unknown
  getTypeChecker(): unknown
}

export function programForQuery(program: TypeScriptProgram): ts.Program {
  return program as ts.Program
}

export function validateTypeScriptApi(
  typescript: TypeScriptApi,
  program: TypeScriptProgram,
  sourceFile: ts.SourceFile,
): void {
  if (
    !typescript.isSourceFile(sourceFile) ||
    sourceFile.kind !== typescript.SyntaxKind.SourceFile
  ) {
    throw new Error(
      'TypeScript API does not recognize the supplied Program source file; pass the same compiler API instance that created the Program',
    )
  }
  program.getTypeChecker()
}
