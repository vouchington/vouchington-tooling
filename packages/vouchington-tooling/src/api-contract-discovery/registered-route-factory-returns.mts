import ts from '../contract-schema/typescript-api.mts'

export function returnedExpressions(
  declaration: ts.FunctionLikeDeclaration,
): (ts.Expression | undefined)[] {
  const body = declaration.body!
  if (!ts.isBlock(body)) return [body]
  const returned: (ts.Expression | undefined)[] = []
  const collect = (node: ts.Node): void => {
    if (node !== declaration && ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node)) {
      returned.push(node.expression)
      return
    }
    node.forEachChild(collect)
  }
  body.forEachChild(collect)
  return returned
}

export function returnsOnEveryPath(node: ts.ConciseBody | ts.Statement): boolean {
  if (ts.isBlock(node)) return node.statements.some(returnsOnEveryPath)
  if (ts.isReturnStatement(node)) return true
  if (ts.isIfStatement(node))
    return (
      !!node.elseStatement &&
      returnsOnEveryPath(node.thenStatement) &&
      returnsOnEveryPath(node.elseStatement)
    )
  return !ts.isStatement(node)
}
