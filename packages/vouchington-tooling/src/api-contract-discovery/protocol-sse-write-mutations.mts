import { contextMutationTargets } from './protocol-http-context-write-targets.mts'
import ts from '../contract-schema/typescript-api.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
import { sameWriteReceiver, type WriteReceiver } from './protocol-write-receiver.mts'
import { writeAccess } from './protocol-sse-write-resolution.mts'

export type SseWriteMutation = { node: ts.Node; receiver: ts.Expression; method: 'write' | 'end' }

export function sseWriteMutations(node: ts.Node): SseWriteMutation[] {
  return contextMutationTargets(node).flatMap((target) => {
    const access = writeAccess(target)
    return access && (access.method === 'write' || access.method === 'end')
      ? [{ node, receiver: access.receiver, method: access.method }]
      : []
  })
}

export function mutationAffectsSelectedStream(
  mutations: readonly SseWriteMutation[],
  frameReceivers: readonly WriteReceiver[],
  checker: ts.TypeChecker,
  isSameRoute: (node: ts.Node) => boolean,
  isInvokedHelper: (node: ts.Node) => boolean,
  resolveActual: (expression: ts.Expression) => readonly (WriteReceiver | undefined)[] | undefined,
  resolveFrame: (receiver: WriteReceiver) => readonly (WriteReceiver | undefined)[],
): boolean {
  const framed = frameReceivers.flatMap(resolveFrame)
  return mutations.some(({ node, receiver, method }) => {
    if (
      !potentiallyExecuted(node) ||
      (!isSourceLevelMutation(node) &&
        !executableProtocolPath(node, checker) &&
        !opaqueProtocolCallbackPath(node, checker) &&
        !isInvokedHelper(node)) ||
      !isSameRoute(node)
    )
      return false
    const actual = resolveActual(receiver)
    if (!actual) return true
    return actual.some(
      (value) =>
        value === undefined ||
        framed.some(
          (frame) =>
            frame === undefined ||
            sameWriteReceiver(frame, value) ||
            prototypeAffectsFrame(value, frame, method, node, checker),
        ),
    )
  })
}

function receiverType(receiver: WriteReceiver, node: ts.Node, checker: ts.TypeChecker): ts.Type {
  const declaration = receiver.root.valueDeclaration
  let type =
    declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
      ? checker.getTypeAtLocation(declaration.initializer)
      : checker.getTypeOfSymbolAtLocation(receiver.root, declaration ?? node)
  for (const part of receiver.path) {
    const property = type.getProperty(part)
    if (!property) return type
    type = checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? node)
  }
  return type
}

function prototypeAffectsFrame(
  value: WriteReceiver,
  frame: WriteReceiver,
  method: 'write' | 'end',
  node: ts.Node,
  checker: ts.TypeChecker,
): boolean {
  const tail = value.path.at(-1)
  if (tail !== '__proto__' && tail !== 'prototype') return false
  const instance = tail === '__proto__' || value.path.at(-2) === 'constructor'
  const root = {
    ...value,
    path: value.path.slice(0, tail === '__proto__' ? -1 : instance ? -2 : -1),
  }
  const owner = receiverType(root, node, checker)
  const owners = instance ? [owner] : owner.getConstructSignatures().map((s) => s.getReturnType())
  const target = receiverType(frame, node, checker)
  return owners.some((prototype) => samePrototypeMethod(prototype, target, method, checker))
}

function samePrototypeMethod(
  prototype: ts.Type,
  target: ts.Type,
  method: 'write' | 'end',
  checker: ts.TypeChecker,
): boolean {
  if (target.isUnionOrIntersection())
    return target.types.some((part) => samePrototypeMethod(prototype, part, method, checker))
  const selected = target.getProperty(method)
  const declarations = selected?.declarations ?? []
  if (
    declarations.some(
      (declaration) =>
        ts.isPropertyDeclaration(declaration) &&
        !!declaration.initializer &&
        !(
          ts.getCombinedModifierFlags(declaration) &
          (ts.ModifierFlags.Static | ts.ModifierFlags.Accessor)
        ),
    )
  )
    return false
  if (
    prototype
      .getProperty(method)
      ?.declarations?.some((declaration) => declarations.includes(declaration))
  )
    return true
  if (target.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return true
  if (target.isClassOrInterface() && target.objectFlags & ts.ObjectFlags.Class) return false
  return checker.isTypeAssignableTo(prototype, target)
}

export function isSourceLevelMutation(node: ts.Node): boolean {
  return ts.isExpressionStatement(node.parent) && ts.isSourceFile(node.parent.parent)
}
