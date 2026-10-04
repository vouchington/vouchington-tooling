import ts from '../contract-schema/typescript-api.mts'
import { standardCompilerDeclaration } from './protocol-platform-callbacks.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import {
  contextResponseMethod,
  httpContextReceiver,
  methodAccess,
} from './protocol-http-method-access.mts'

/** Only the actual compiler-library Reflect.apply signature has this argument layout. */
function standardReflectApply(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const declaration = checker.getResolvedSignature(call)?.declaration
  if (!declaration || !ts.isFunctionDeclaration(declaration) || declaration.name?.text !== 'apply')
    return false
  const namespace = declaration.parent.parent
  return (
    ts.isModuleDeclaration(namespace) &&
    namespace.name.text === 'Reflect' &&
    standardCompilerDeclaration(declaration, checker)
  )
}

/** Reflected context emissions cannot prove the marked status or response body. */
export function reflectHttpResponseMethod(
  call: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
): string | undefined {
  if (!standardReflectApply(call, checker)) return undefined
  const target = call.arguments[0]
  const direct = target && contextResponseMethod(target, context, checker, true)
  if (direct) return direct
  const method = target && expressionReceiver(target, checker)
  if (method?.root === context)
    return method.path[0] === 'response' ? method.path.slice(0, 2).join('.') : method.path[0]
  const receiver = call.arguments[1] && httpContextReceiver(call.arguments[1], checker)
  const name = (target && methodAccess(target)?.name) ?? method?.path.at(-1)
  if (receiver?.root !== context || !name) return undefined
  return receiver.path.length === 0
    ? name
    : receiver.path.length === 1 && receiver.path[0] === 'response'
      ? `response.${name}`
      : undefined
}
