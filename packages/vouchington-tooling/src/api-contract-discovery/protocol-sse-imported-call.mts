import { callbackCapturesSelectedReceiver } from './protocol-sse-callback-capture.mts'
import ts from '../contract-schema/typescript-api.mts'
import {
  containsSelectedSseOrigin,
  selectedSseOriginUnexposed,
} from './protocol-sse-selected-origin.mts'
import { contextResponseMethod } from './protocol-http-context.mts'
import { createImportedSseBodyProof } from './protocol-sse-imported-body-proof.mts'
import { factoryPipeline } from './protocol-sse-pipeline-origin.mts'
import { actualReceivers, type createSseWriteLookup } from './protocol-sse-write-helpers.mts'
import { expressionReceiver, type WriteReceiver } from './protocol-write-receiver.mts'
import type { RouteBinding } from './response-contract-route-analysis.mts'

/** Prove the reached concrete helper with only this route's selected stream capabilities. */
export function importedSseCallSafe(
  call: ts.CallExpression,
  receivers: readonly WriteReceiver[],
  binding: RouteBinding,
  checker: ts.TypeChecker,
  lookup: ReturnType<typeof createSseWriteLookup>,
  framedWrites: ReadonlySet<ts.CallExpression>,
): boolean {
  if (lookup.implementationCall(call)) return false
  const framed = receivers.flatMap((receiver) =>
    actualReceivers(receiver, binding, checker, lookup).map((actual) => actual ?? receiver),
  )
  const indices = call.arguments.flatMap((argument, index) =>
    containsSelectedSseOrigin(argument, framed, checker) ? [index] : [],
  )
  const properties = framed.flatMap((frame) => {
    let declaration = frame.root.valueDeclaration
    let path = frame.path
    if (declaration && ts.isBindingElement(declaration)) {
      const name = declaration.propertyName ?? declaration.name
      if (
        !ts.isObjectBindingPattern(declaration.parent) ||
        declaration.dotDotDotToken ||
        (!ts.isIdentifier(name) && !ts.isStringLiteral(name))
      )
        return []
      path = [name.text, ...path]
      declaration = declaration.parent.parent
    }
    return declaration &&
      ts.isVariableDeclaration(declaration) &&
      (declaration.initializer === call ||
        (ts.isBinaryExpression(call.parent) &&
          call.parent.right === call &&
          expressionReceiver(call.parent.left, checker)?.root === frame.root)) &&
      path.length === 1
      ? [path[0]!]
      : []
  })
  // A factory's context parameter is not its returned stream. Its body is inspected using
  // the selected returned property, and pipeline authorization binds that exact invocation.
  const safe = createImportedSseBodyProof(
    checker,
    (selected) => lookup.actualImplementationCall(selected, binding),
    (node, stream, owner) => {
      if (framedWrites.has(node)) return true
      return (
        !!owner.context &&
        contextResponseMethod(node.expression, owner.context, checker) === 'pipeline' &&
        !!node.arguments[0] &&
        !!expressionReceiver(node.arguments[0], checker) &&
        framed.some((frame) => factoryPipeline(frame, owner.root, owner.fn, stream, checker))
      )
    },
  )
  if (properties.length) return safe(call, [], properties)
  if (indices.length) return safe(call, indices)
  if (!selectedSseOriginUnexposed(framed, checker)) return false
  const capturedIndices = call.arguments.flatMap((argument, index) => {
    let captured = false
    const inspect = (node: ts.Node): void => {
      if (
        (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        framed.some((frame) => callbackCapturesSelectedReceiver(node, frame, checker))
      )
        captured = true
      if (!captured) node.forEachChild(inspect)
    }
    inspect(argument)
    return captured ? [index] : []
  })
  if (capturedIndices.length && safe(call, capturedIndices)) return true
  let callbacksSafe = true
  const visit = (node: ts.Node): void => {
    if (!callbacksSafe) return
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body) {
      if (!ts.isBlock(node.body) && containsSelectedSseOrigin(node.body, framed, checker)) {
        callbacksSafe = false
        return
      }
      const proveCallback = createImportedSseBodyProof(
        checker,
        (selected) => (selected === call ? node : lookup.actualImplementationCall(selected)),
        (selected) => framedWrites.has(selected),
      )
      if (!proveCallback(call, [], [], framed)) callbacksSafe = false
      return
    }
    node.forEachChild(visit)
  }
  for (const argument of call.arguments) visit(argument)
  return callbacksSafe && safe(call, [], [], framed)
}
