import ts from '../contract-schema/typescript-api.mts'
import { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import { contextMutationTargets } from './protocol-http-context-write-targets.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { createContextExtensionApplication } from './protocol-http-context-extension-application.mts'
import { httpContextArgument } from './protocol-http-context.mts'
import type {
  createProtocolCallbackValueResolver,
  CallbackBindings,
} from './protocol-callback-values.mts'

type Resolver = ReturnType<typeof createProtocolCallbackValueResolver>
type Extension = {
  node: ts.FunctionLikeDeclaration
  env: CallbackBindings
  thisParameter: ts.Symbol
  application: ts.Symbol
}

/** Resolve only concrete producers installed on the actual registered application. */
export function createHttpContextExtensionLookup(
  checker: ts.TypeChecker,
  sources: readonly ts.SourceFile[],
  resolver: Resolver,
  applicationClass: ts.Symbol | undefined,
) {
  const roots = createContextValueRoots(checker)
  const calls: ts.CallExpression[] = []
  const writes: ts.Expression[] = []
  for (const source of sources) {
    if (source.isDeclarationFile) continue
    function visit(node: ts.Node) {
      if (!potentiallyExecuted(node)) return
      writes.push(...contextMutationTargets(node))
      if (ts.isCallExpression(node)) calls.push(node)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const applicationOf = createContextExtensionApplication(checker, calls, writes, roots, resolver)
  function access(call: ts.CallExpression) {
    const value = unwrapExpression(call.expression)
    return ts.isPropertyAccessExpression(value) ? value : undefined
  }
  function find(
    call: ts.CallExpression,
    context: ts.Symbol,
    application: ts.Symbol,
    selected: ts.PropertyAccessExpression,
  ): Extension | undefined {
    const member = checker.getSymbolAtLocation(selected.name)
    const contextType = checker.getTypeOfSymbolAtLocation(context, call)
    if (checker.getTypeAtLocation(selected.expression).getSymbol() !== contextType.getSymbol())
      return undefined
    const appDeclaration = application.valueDeclaration
    if (!appDeclaration) return undefined
    const appType = checker.getTypeOfSymbolAtLocation(application, appDeclaration)
    if (!applicationClass || appType.getSymbol() !== applicationClass) return undefined
    const extend = checker.getPropertyOfType(appType, 'extend')
    const route = checker.getPropertyOfType(appType, 'route')
    const owner = extend?.declarations?.[0]?.parent
    if (
      !owner ||
      !ts.isClassDeclaration(owner) ||
      !applicationClass.declarations?.includes(owner) ||
      route?.declarations?.[0]?.parent !== owner
    )
      return undefined
    const registrations = calls.filter((candidate) => {
      const target = access(candidate)
      if (target?.name.text !== 'extend') return false
      const producer = enclosingFunction(candidate)
      if (
        producer &&
        !calls.some(
          (caller) =>
            !enclosingFunction(caller) &&
            resolver.resolve(caller.expression, new Map())?.node === producer,
        )
      )
        return false
      return applicationOf(target.expression) === application
    })
    let result: Extension | undefined
    for (const registration of registrations) {
      const target = access(registration)!
      if (
        checker.getSymbolAtLocation(target.name) !== extend ||
        registration.arguments.length !== 1
      )
        return undefined
      const argument = unwrapExpression(registration.arguments[0]!)
      const symbol = roots.root(argument)
      const declaration = symbol?.valueDeclaration
      if (
        !symbol ||
        !declaration ||
        !ts.isVariableDeclaration(declaration) ||
        !ts.isVariableDeclarationList(declaration.parent) ||
        !(declaration.parent.flags & ts.NodeFlags.Const) ||
        !declaration.initializer ||
        writes.some((write) => roots.referencesContainer(write, symbol))
      )
        return undefined
      if (
        calls.some(
          (consumer) =>
            consumer !== registration &&
            consumer.arguments.some((value) => roots.referencesContainer(value, symbol)) &&
            !registrations.includes(consumer),
        )
      )
        return undefined
      const literal = unwrapExpression(declaration.initializer)
      if (
        !ts.isObjectLiteralExpression(literal) ||
        literal.properties.some(
          (property) => !ts.isMethodDeclaration(property) || !ts.isIdentifier(property.name),
        )
      )
        return undefined
      const names = literal.properties.map((property) => property.name!.getText())
      if (new Set(names).size !== names.length) return undefined
      const method = literal.properties.find(
        (property) => property.name!.getText() === selected.name.text,
      )
      if (!method || !ts.isMethodDeclaration(method) || !method.body) continue
      const parameter = method.parameters[0]
      if (!parameter || parameter.name.getText() !== 'this' || !parameter.type) return undefined
      const thisType = checker.getTypeAtLocation(parameter)
      const thisParameter = checker.getSymbolAtLocation(parameter.name)
      if (
        !thisParameter ||
        thisType.getSymbol() !== contextType.getSymbol() ||
        checker.getPropertyOfType(thisType, selected.name.text) !== member
      )
        return undefined
      if (result) return undefined
      result = { node: method, env: new Map(), thisParameter, application }
    }
    return result
  }
  const cache = new Map<ts.Symbol, Map<ts.Symbol, Extension | undefined>>()
  return (call: ts.CallExpression, context: ts.Symbol, application: ts.Symbol) => {
    const target = access(call)
    if (!target || !httpContextArgument(target.expression, context, checker)) return undefined
    const member = target && checker.getSymbolAtLocation(target.name)
    if (!member) return undefined
    let methods = cache.get(application)
    if (!methods) {
      methods = new Map()
      cache.set(application, methods)
    }
    if (!methods.has(member)) methods.set(member, find(call, context, application, target))
    return methods.get(member)
  }
}
