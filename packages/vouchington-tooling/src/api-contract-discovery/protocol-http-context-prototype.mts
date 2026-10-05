import ts from '../contract-schema/typescript-api.mts'
import { createContextCapture } from './protocol-http-context-capture.mts'
import { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import { contextWriteTargets } from './protocol-http-context-write-targets.mts'

/** Missing own properties require unchanged global prototype capabilities in this Program. */
export function createContextPrototypeProof(
  checker: ts.TypeChecker,
  sources?: readonly ts.SourceFile[],
) {
  let result: boolean | undefined
  const roots = createContextValueRoots(checker)
  const capture = createContextCapture(checker, roots)
  function globalObject(symbol: ts.Symbol | undefined): boolean {
    return symbol?.name === 'Object' && !!symbol.valueDeclaration?.getSourceFile().isDeclarationFile
  }
  return (): boolean => {
    if (result !== undefined) return result
    result = !!sources
    function visit(node: ts.Node) {
      if (!result) return
      const write = ts.isDeleteExpression(node)
        ? node.expression
        : ts.isBinaryExpression(node) &&
            node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          ? node.left
          : (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
              (node.operator === ts.SyntaxKind.PlusPlusToken ||
                node.operator === ts.SyntaxKind.MinusMinusToken)
            ? node.operand
            : undefined
      if (write && contextWriteTargets(write).some((target) => globalObject(roots.root(target))))
        result = false
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        node.arguments?.some((argument) => [...capture(argument)].some(globalObject))
      )
        result = false
      ts.forEachChild(node, visit)
    }
    for (const source of sources ?? []) visit(source)
    return result
  }
}
