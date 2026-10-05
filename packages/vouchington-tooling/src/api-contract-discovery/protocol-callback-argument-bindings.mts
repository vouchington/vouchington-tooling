import ts from '../contract-schema/typescript-api.mts'
import { contextEffectiveArguments } from './protocol-http-context-forwarded-target.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import type {
  CallbackBindings,
  createProtocolCallbackValueResolver,
} from './protocol-callback-values.mts'

/** Binds literal callback parameters, declining unsupported destructuring shapes. */
export function callbackArgumentBindings(
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression | ts.NewExpression,
  env: CallbackBindings,
  captured: CallbackBindings,
  checker: ts.TypeChecker,
  resolver: ReturnType<typeof createProtocolCallbackValueResolver>,
): Map<ts.Symbol, { node: ts.Node; env: CallbackBindings }> | undefined {
  const next = new Map(captured)
  const arguments_ = contextEffectiveArguments(fn, call, checker)
  for (const [index, parameter] of runtimeParameters(fn).entries()) {
    const argument = arguments_[index]
    if (!argument) continue
    if (ts.isSpreadElement(argument)) return undefined
    const argumentEnv = argument === parameter.initializer ? new Map(next) : env
    if (ts.isIdentifier(parameter.name)) {
      next.set(checker.getSymbolAtLocation(parameter.name)!, { node: argument, env: argumentEnv })
    } else {
      if (!ts.isObjectBindingPattern(parameter.name)) return undefined
      const value = resolver.resolve(argument, argumentEnv)
      for (const element of parameter.name.elements) {
        const key = element.propertyName ?? element.name
        if (
          !ts.isIdentifier(element.name) ||
          element.dotDotDotToken ||
          element.initializer ||
          !(ts.isIdentifier(key) || ts.isStringLiteral(key))
        )
          return undefined
        const bound = resolver.property(value, key.text, new Set())
        if (bound) next.set(checker.getSymbolAtLocation(element.name)!, bound)
      }
    }
  }
  return next
}
