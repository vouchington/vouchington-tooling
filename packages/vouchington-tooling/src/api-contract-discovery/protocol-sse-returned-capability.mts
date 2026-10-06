import { potentiallyExecuted } from './protocol-executable-path.mts'
import { storedSseContainerCapability } from './protocol-sse-container-writes.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction,
} from './protocol-callback-values.mts'
import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { selectedSseWrapperCapture } from './protocol-sse-wrapper-captures.mts'
import { sseCapabilityOutputs } from './protocol-sse-capability-outputs.mts'
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
    if (!potentiallyExecuted(expression)) return false
    const value = unwrapExpression(expression)
    if (selected(value)) return true
    if (active.has(value)) return true
    active.add(value)
    try {
      if (selectedSseWrapperCapture(value, checker, (value) => contains(value, bindings)))
        return true
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
        return sseCapabilityOutputs(fn).some((returned) => !!returned && contains(returned, next))
      }
      if (ts.isArrowFunction(value) || ts.isFunctionExpression(value))
        return sseCapabilityOutputs(value).some(
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
        if (storedSseContainerCapability(value, checker, (stored) => contains(stored, bindings)))
          return true
        const symbol = checker.getSymbolAtLocation(value)
        if (symbol && bindings.has(symbol)) return bindings.get(symbol)!
        const declaration = symbol?.valueDeclaration
        if (declaration && ts.isFunctionDeclaration(declaration) && declaration.body)
          return sseCapabilityOutputs(declaration).some(
            (returned) => !!returned && contains(returned, bindings),
          )
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
  return someSseArgumentValue(
    target.expression,
    checker,
    (value) => {
      const receiver = expressionReceiver(value, checker)
      return (
        !!receiver &&
        resolve(receiver).some(
          (actual) =>
            (actual === undefined && receiver.mutableAlias === true) ||
            framed.some((frame) => frame !== undefined && sameWriteReceiver(frame, actual)),
        )
      )
    },
    true,
  )
}

/** Only stable actual callable aliases participate in the callable return proof. */
export function sseCallableAlias(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): ts.FunctionLikeDeclaration | undefined {
  const fn = ts.isIdentifier(expression)
    ? createProtocolCallbackValueResolver(checker).resolve(expression, new Map())?.node
    : undefined
  return fn && isProtocolCallbackFunction(fn) && fn.body ? fn : undefined
}
