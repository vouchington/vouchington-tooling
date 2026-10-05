import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
import {
  expressionReceiver,
  sameWriteReceiver,
  type WriteReceiver,
} from './protocol-write-receiver.mts'
import { someSseArgumentValue } from './protocol-sse-literal-arguments.mts'

/** Concrete helper results retain caller-bound selected arguments and constant local aliases. */
function returnedSseCapability(
  call: ts.Expression,
  checker: ts.TypeChecker,
  implementation: (call: ts.CallExpression) => ts.Node | undefined,
  selected: (value: ts.Expression) => boolean,
): boolean {
  const active = new Set<ts.Node>()
  function contains(expression: ts.Expression, bindings: ReadonlyMap<ts.Symbol, boolean>): boolean {
    const value = unwrapExpression(expression)
    if (selected(value)) return true
    if (active.has(value)) return true
    active.add(value)
    try {
      if (ts.isCallExpression(value)) {
        const argumentsSelected = value.arguments.map((argument) => contains(argument, bindings))
        const fn = implementation(value)
        if (!fn || !ts.isFunctionLike(fn) || !('body' in fn) || !fn.body)
          return argumentsSelected.some(Boolean)
        const next = new Map(bindings)
        for (const [index, parameter] of fn.parameters.entries()) {
          if (!ts.isIdentifier(parameter.name) || parameter.dotDotDotToken || parameter.initializer)
            return true
          const symbol = checker.getSymbolAtLocation(parameter.name)!
          next.set(symbol, argumentsSelected[index] ?? false)
        }
        return returnedExpressions(fn).some((returned) => !!returned && contains(returned, next))
      }
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
        return returnedExpressions(value).some(
          (returned) => !!returned && contains(returned, bindings),
        )
      if (ts.isConditionalExpression(value))
        return contains(value.whenTrue, bindings) || contains(value.whenFalse, bindings)
      if (
        ts.isBinaryExpression(value) &&
        [
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.CommaToken,
        ].includes(value.operatorToken.kind)
      )
        return contains(value.left, bindings) || contains(value.right, bindings)
      if (ts.isIdentifier(value)) {
        const symbol = checker.getSymbolAtLocation(value)
        if (symbol && bindings.has(symbol)) return bindings.get(symbol)!
        const declaration = symbol?.valueDeclaration
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer)
          return contains(declaration.initializer, bindings)
      }
      return someSseArgumentValue(
        value,
        checker,
        (leaf) => leaf !== value && contains(leaf, bindings),
      )
    } finally {
      active.delete(value)
    }
  }
  return contains(call, new Map())
}

export function selectedReturnedSseCapability(
  call: ts.Expression,
  checker: ts.TypeChecker,
  implementation: (call: ts.CallExpression) => ts.Node | undefined,
  framed: readonly (WriteReceiver | undefined)[],
  resolve: (receiver: WriteReceiver) => readonly (WriteReceiver | undefined)[],
): boolean {
  return returnedSseCapability(call, checker, implementation, (expression) => {
    const receiver = expressionReceiver(expression, checker)
    return (
      !!receiver &&
      resolve(receiver).some(
        (actual) =>
          actual === undefined ||
          framed.some((frame) => frame === undefined || sameWriteReceiver(frame, actual)),
      )
    )
  })
}

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

/** An unknown member implementation receives its actual receiver as this. */
export function selectedOpaqueSseReceiver(
  call: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression,
  checker: ts.TypeChecker,
  framed: readonly (WriteReceiver | undefined)[],
  resolve: (receiver: WriteReceiver) => readonly (WriteReceiver | undefined)[],
): boolean {
  const target = ts.isTaggedTemplateExpression(call)
    ? call.tag
    : ts.isCallExpression(call) && call.expression
  if (!target || !(ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)))
    return false
  const receiver = expressionReceiver(target.expression, checker)
  return (
    !!receiver &&
    resolve(receiver).some(
      (actual) =>
        actual !== undefined &&
        framed.some((frame) => frame !== undefined && sameWriteReceiver(frame, actual)),
    )
  )
}

/** Only stable actual callable aliases participate in the callable return proof. */
export function sseCallableAlias(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.FunctionLikeDeclaration | undefined {
  return ts.isIdentifier(expression)
    ? createProtocolCallbackValueResolver(checker).resolve(expression, new Map())?.node
    : undefined
}
