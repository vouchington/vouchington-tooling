import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
import { symbolBindingWritten } from './protocol-sse-binding-writes.mts'
import type { WriteReceiver } from './protocol-write-receiver.mts'

/** Recognize only values with a separately allocated origin needed by SSE control calls. */
export function independentArgumentOrigin(actual: WriteReceiver, checker: ts.TypeChecker): boolean {
  if (actual.path.length !== 0) return false
  const declaration = actual.root.valueDeclaration
  if (declaration && ts.isFunctionDeclaration(declaration) && declaration.body)
    return (
      !declaration.asteriskToken &&
      !symbolBindingWritten(declaration.getSourceFile(), actual.root, checker) &&
      returnedExpressions(declaration).every((value) => value === undefined)
    )
  if (
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const) ||
    !declaration.initializer ||
    symbolBindingWritten(declaration.getSourceFile(), actual.root, checker)
  )
    return false
  const initializer = unwrapExpression(declaration.initializer)
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    return (
      !(ts.isFunctionExpression(initializer) && initializer.asteriskToken) &&
      returnedExpressions(initializer).every((value) => value === undefined)
    )
  if (ts.isStringLiteral(initializer) || ts.isNumericLiteral(initializer)) return true
  if (!ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression)) return false
  if (initializer.expression.text !== 'setInterval') return false
  const timerSymbol = checker.getSymbolAtLocation(initializer.expression)
  if (!timerSymbol || symbolBindingWritten(initializer.getSourceFile(), timerSymbol, checker))
    return false
  const declarationFile = checker.getResolvedSignature(initializer)?.declaration?.getSourceFile()
  if (!declarationFile?.isDeclarationFile) return false
  const file = declarationFile.fileName.replaceAll('\\', '/')
  return /\/(?:@types\/node\/(?:web-globals\/)?timers|lib\.dom)\.d\.ts$/.test(file)
}
