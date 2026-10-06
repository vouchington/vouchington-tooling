import ts from '../contract-schema/typescript-api.mts'
import { registeredHandler } from './protocol-callback-registration.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { handlerNodes } from './registered-route-handler-analysis.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'

/** Only the actual registered handler establishes the application owning its context. */
export function registeredContextApplication(
  root: ts.CallExpression,
  checker: ts.TypeChecker,
  sources: readonly ts.SourceFile[],
): ts.Symbol | undefined {
  const owner = enclosingFunction(root)
  if (!owner) return undefined
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
          if (!ts.isCallExpression(receiver)) break
          const method = unwrapExpression(receiver.expression)
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
