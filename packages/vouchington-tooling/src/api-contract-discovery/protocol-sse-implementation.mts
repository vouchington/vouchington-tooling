import ts from '../contract-schema/typescript-api.mts'

export function implementationDeclaration(
  declaration: ts.Signature['declaration'],
  checker: ts.TypeChecker,
): ts.FunctionLikeDeclaration | undefined {
  if (!declaration) return undefined
  if (ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) return declaration
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) {
    if (declaration.body) return declaration
    const symbol = declaration.name && checker.getSymbolAtLocation(declaration.name)
    return symbol?.declarations?.find(
      (candidate): candidate is ts.FunctionLikeDeclaration =>
        (ts.isFunctionDeclaration(candidate) || ts.isMethodDeclaration(candidate)) &&
        !!candidate.body,
    )
  }
  return undefined
}
