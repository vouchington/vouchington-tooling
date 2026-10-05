import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { someSseArgumentValue } from './protocol-sse-literal-arguments.mts'
import { contextMutationTargets } from './protocol-http-context-write-targets.mts'
import { expressionReceiver, type WriteReceiver } from './protocol-write-receiver.mts'
import { ownerHasFreshAllocation } from './protocol-sse-owner-allocation.mts'

/** Follow actual receiver/container aliases, rather than assuming every object is the stream. */
export function containsSelectedSseOrigin(
  expression: ts.Expression,
  selected: readonly WriteReceiver[],
  checker: ts.TypeChecker,
  active = new Set<ts.Symbol>(),
): boolean {
  const unwrapped = unwrapExpression(expression)
  if (ts.isConditionalExpression(unwrapped))
    return (
      containsSelectedSseOrigin(unwrapped.whenTrue, selected, checker, active) ||
      containsSelectedSseOrigin(unwrapped.whenFalse, selected, checker, active)
    )
  if (
    ts.isBinaryExpression(unwrapped) &&
    [
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
    ].includes(unwrapped.operatorToken.kind)
  )
    return (
      containsSelectedSseOrigin(unwrapped.left, selected, checker, active) ||
      containsSelectedSseOrigin(unwrapped.right, selected, checker, active)
    )
  return someSseArgumentValue(expression, checker, (value) => {
    const receiver = expressionReceiver(value, checker)
    if (
      receiver &&
      selected.some(
        (frame) =>
          frame.root === receiver.root &&
          (frame.path.every((part, index) => receiver.path[index] === part) ||
            receiver.path.every((part, index) => frame.path[index] === part)),
      )
    )
      return true
    const plain = unwrapExpression(value)
    if (!ts.isIdentifier(plain)) return false
    const symbol = checker.getSymbolAtLocation(plain)
    if (!symbol || active.has(symbol)) return false
    const declaration = symbol.valueDeclaration
    if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer)
      return false
    const initializer = unwrapExpression(declaration.initializer)
    if (
      !ts.isObjectLiteralExpression(initializer) &&
      !ts.isArrayLiteralExpression(initializer) &&
      !ts.isConditionalExpression(initializer) &&
      !ts.isBinaryExpression(initializer)
    )
      return false
    return containsSelectedSseOrigin(initializer, selected, checker, new Set(active).add(symbol))
  })
}

/** A concrete producer cannot obtain this fresh root from an observable stored caller alias. */
export function selectedSseOriginUnexposed(
  selected: readonly WriteReceiver[],
  checker: ts.TypeChecker,
  freshlyAllocated: typeof ownerHasFreshAllocation = ownerHasFreshAllocation,
): boolean {
  if (!selected.length || selected.some((frame) => !freshlyAllocated(frame, checker))) return false
  const sources = new Set(
    selected.flatMap((frame) =>
      frame.root.valueDeclaration ? [frame.root.valueDeclaration.getSourceFile()] : [],
    ),
  )
  let safe = true
  const contains = (expression: ts.Expression) =>
    containsSelectedSseOrigin(expression, selected, checker)
  const visit = (node: ts.Node): void => {
    if (!safe) return
    if (
      (ts.isReturnStatement(node) || ts.isThrowStatement(node)) &&
      node.expression &&
      contains(node.expression)
    ) {
      safe = false
      return
    }
    if (
      ts.isBinaryExpression(node) &&
      contextMutationTargets(node).length &&
      contains(node.right)
    ) {
      safe = false
      return
    }
    node.forEachChild(visit)
  }
  for (const source of sources) visit(source)
  return safe
}
