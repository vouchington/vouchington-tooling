import ts from '../contract-schema/typescript-api.mts'
import type { WriteReceiver } from './protocol-write-receiver.mts'

/** Temporal allocation does not prevent a retained callback from reading the owner later. */
export function argumentMayReachFutureOwner(
  actual: WriteReceiver,
  selected: WriteReceiver,
  checker: ts.TypeChecker,
): boolean {
  const declaration = actual.root.valueDeclaration
  const scope =
    declaration && ts.isFunctionDeclaration(declaration)
      ? declaration.body
      : declaration && ts.isVariableDeclaration(declaration)
        ? declaration.initializer
        : undefined
  if (!scope) {
    const type = declaration && checker.getTypeOfSymbolAtLocation(actual.root, declaration)
    return !!type && type.getCallSignatures().length > 0
  }
  const mayReachOwner = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node)) {
      if (checker.getSymbolAtLocation(node) === selected.root) return true
      // A referenced callable can capture the owner indirectly. Do not chase its body or aliases.
      const type = checker.getTypeAtLocation(node)
      if (type.getCallSignatures().length || type.getConstructSignatures().length) return true
    }
    return node.forEachChild(mayReachOwner) === true
  }
  return mayReachOwner(scope)
}
