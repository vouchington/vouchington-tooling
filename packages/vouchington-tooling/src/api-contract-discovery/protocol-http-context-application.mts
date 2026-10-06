import ts from '../contract-schema/typescript-api.mts'
import { registeredHandler } from './protocol-callback-registration.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { handlerNodes } from './registered-route-handler-analysis.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { opaqueProtocolCallbackPath } from './protocol-opaque-callback.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'

/** Only the actual registered handler establishes the application owning its context. */
export function registeredContextApplication(
  root: ts.CallExpression,
  checker: ts.TypeChecker,
  sources: readonly ts.SourceFile[],
  rootContext?: ts.Symbol,
): ts.Symbol | undefined {
  let owner = enclosingFunction(root)
  if (!owner) return undefined
  if (rootContext) {
    const target = unwrapExpression(root.expression)
    const receivers =
      ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)
        ? [target.expression]
        : []
    const argument = [...root.arguments, ...receivers].some((value) => {
      const receiver = expressionReceiver(value, checker)
      return receiver?.root === rootContext && !receiver.mutableAlias && !receiver.path.length
    })
    if (!argument) return undefined
    while (
      owner &&
      !owner.parameters.some(
        (parameter) =>
          ts.isIdentifier(parameter.name) &&
          checker.getSymbolAtLocation(parameter.name) === rootContext,
      )
    )
      owner = enclosingFunction(owner)
    if (
      !owner ||
      !(executableProtocolPath(root, checker, owner) || opaqueProtocolCallbackPath(root, checker))
    )
      return undefined
  }
  const applications = new Set<ts.Symbol>()
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && registeredHandler(node) && potentiallyExecuted(node)) {
      const handlers = node.arguments.flatMap((argument) =>
        handlerNodes(argument, checker, new Map(), new Set(), true),
      )
      if (handlers.includes(owner!)) {
        let target = unwrapExpression(node.expression)
        while (ts.isPropertyAccessExpression(target)) {
          const receiver = unwrapExpression(target.expression)
          const method = unwrapExpression((receiver as ts.CallExpression).expression)
          if (ts.isPropertyAccessExpression(method) && method.name.text === 'route') {
            const application = expressionReceiver(method.expression, checker)
            if (application && !application.mutableAlias && !application.path.length)
              applications.add(application.root)
            break
          }
          target = method
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  sources.forEach(visit)
  return applications.size === 1 ? [...applications][0] : undefined
}
