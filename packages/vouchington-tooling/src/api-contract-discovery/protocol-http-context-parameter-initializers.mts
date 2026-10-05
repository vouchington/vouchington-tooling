import ts from '../contract-schema/typescript-api.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { httpContextArgument } from './protocol-http-context.mts'
import type { CallbackBindings } from './protocol-callback-values.mts'

/** Defaults execute only for omitted or potentially undefined arguments in this caller's bindings. */
export function contextCallbackExecutionRoots(
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression,
  env: CallbackBindings,
  checker: ts.TypeChecker,
  contexts: readonly ts.Symbol[],
): ts.Node[] {
  function mayDefault(
    node: ts.Node,
    bindings: CallbackBindings,
    seen = new Set<ts.Node>(),
  ): boolean {
    if (seen.has(node) || !ts.isExpression(node)) return true
    const next = new Set(seen).add(node)
    node = unwrapExpression(node)
    if (ts.isSatisfiesExpression(node)) return mayDefault(node.expression, bindings, next)
    if (contexts.some((context) => httpContextArgument(node as ts.Expression, context, checker)))
      return false
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node)
      const bound = symbol && bindings.get(symbol)
      if (bound) return mayDefault(bound.node, bound.env, next)
      const declaration = symbol?.valueDeclaration
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        ts.isVariableDeclarationList(declaration.parent) &&
        declaration.parent.flags & ts.NodeFlags.Const
      )
        return mayDefault(declaration.initializer, bindings, next)
    }
    const type = checker.getTypeAtLocation(node)
    return (type.isUnion() ? type.types : [type]).some(
      (value) =>
        !!(
          value.flags &
          (ts.TypeFlags.Any |
            ts.TypeFlags.Unknown |
            ts.TypeFlags.Undefined |
            ts.TypeFlags.Void |
            ts.TypeFlags.TypeParameter)
        ),
    )
  }
  const parameters = runtimeParameters(fn).filter((parameter, index) => {
    if (!parameter.initializer && ts.isIdentifier(parameter.name)) return false
    const argument = call.arguments[index]
    return !argument || mayDefault(argument, env)
  })
  return [...parameters, fn.body!]
}
