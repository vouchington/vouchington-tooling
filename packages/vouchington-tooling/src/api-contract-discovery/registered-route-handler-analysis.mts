import ts from '../contract-schema/typescript-api.mts'
import { returnedExpressions, returnsOnEveryPath } from './registered-route-factory-returns.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'
import { hasStableBinding, unwrapHandlerExpression } from './registered-route-handler-helpers.mts'
import { isConditionalPosition } from './request-validation-conditional.mts'

export type HandlerProof = {
  node: ts.FunctionLikeDeclaration
  bindings: Map<ts.Symbol, ts.Expression>
  /** Set under `executableReturns` when a runtime branch selects the handler. */
  conditional?: boolean
}

export function handlerNodes(
  argument: ts.Expression,
  checker: ts.TypeChecker,
  parameterBindings = new Map<ts.Symbol, ts.Expression>(),
  active = new Set<ts.Node>(),
  staticProof = false,
  proofs?: HandlerProof[],
  /** Ignore `let`, `var` and reassigned bindings; always on under `staticProof`. */
  stableBindings = staticProof,
  /** Ignore returned values on statically dead paths, and mark runtime-branch ones conditional. */
  executableReturns = false,
): ts.Node[] {
  const again = (node: ts.Expression, bindings = parameterBindings, seen = active, sink = proofs) =>
    handlerNodes(
      node,
      checker,
      bindings,
      seen,
      staticProof,
      sink,
      stableBindings,
      executableReturns,
    )
  const unwrapped = unwrapHandlerExpression(argument)
  if (unwrapped !== argument) return again(unwrapped)
  let bound = argument
  const boundIdentifiers = new Set<ts.Node>()
  while (ts.isIdentifier(bound)) {
    const symbol = checker.getSymbolAtLocation(bound)
    const nextArgument = symbol && parameterBindings.get(symbol)
    if (!nextArgument) break
    if (boundIdentifiers.has(bound)) return []
    boundIdentifiers.add(bound)
    bound = nextArgument
  }
  if (bound !== argument) return again(bound)
  if (active.has(argument)) return []
  const next = new Set(active).add(argument)
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
    proofs?.push({ node: argument, bindings: parameterBindings })
    return [argument]
  }
  if (ts.isCallExpression(argument)) {
    const resolvedProofs: HandlerProof[] = []
    const groups = callableImplementations(
      argument.expression,
      checker,
      staticProof,
      stableBindings,
    ).map((implementation) => {
      if (
        staticProof &&
        (implementation.asteriskToken ||
          implementation.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
          ) ||
          runtimeParameters(implementation).some((parameter) =>
            hasBindingWrite(parameter, checker),
          ))
      )
        return []
      const bindings = new Map(parameterBindings)
      runtimeParameters(implementation).forEach((parameter, index) => {
        const callArgument = argument.arguments[index]
        const symbol = checker.getSymbolAtLocation(parameter.name)
        if (callArgument && symbol) bindings.set(symbol, callArgument)
      })
      const returned = returnedExpressions(implementation).filter(
        (value) => !executableReturns || !value || potentiallyExecuted(value),
      )
      if (
        staticProof &&
        (!returnsOnEveryPath(implementation.body!) || returned.some((value) => !value))
      )
        return []
      const results = returned.map((value) => {
        const selected: HandlerProof[] = []
        const found = value ? again(value, bindings, next, selected) : []
        if (executableReturns && value && isConditionalPosition(value))
          selected.forEach((proof) => (proof.conditional = true))
        resolvedProofs.push(...selected)
        return found
      })
      return staticProof && results.some((result) => !result.some(ts.isFunctionLike))
        ? []
        : results.flat()
    })
    if (staticProof && groups.some((group) => group.length === 0)) return []
    proofs?.push(...resolvedProofs)
    return groups.flat()
  }
  return declarationImplementations(
    argument,
    checker,
    next,
    staticProof,
    parameterBindings,
    proofs,
    stableBindings,
    executableReturns,
  )
}

function callableImplementations(
  node: ts.Node,
  checker: ts.TypeChecker,
  staticProof = false,
  stableBindings = staticProof,
): ts.FunctionLikeDeclaration[] {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return []
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const implementations: ts.FunctionLikeDeclaration[] = []
  for (const declaration of resolved.declarations ?? []) {
    if (stableBindings && !hasStableBinding(declaration, checker)) continue
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initializer = unwrapHandlerExpression(declaration.initializer)
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        implementations.push(initializer)
      continue
    }
    if (
      (ts.isFunctionDeclaration(declaration) ||
        (!staticProof && ts.isMethodDeclaration(declaration))) &&
      declaration.body
    )
      implementations.push(declaration)
  }
  return implementations
}

function declarationImplementations(
  node: ts.Node,
  checker: ts.TypeChecker,
  active: Set<ts.Node>,
  staticProof: boolean,
  parameterBindings: Map<ts.Symbol, ts.Expression>,
  proofs?: HandlerProof[],
  stableBindings = staticProof,
  executableReturns = false,
): ts.Node[] {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return []
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  return (resolved.declarations ?? []).flatMap((declaration) => {
    if (stableBindings && !hasStableBinding(declaration, checker)) return []
    if (
      ts.isFunctionDeclaration(declaration) ||
      (!staticProof && ts.isMethodDeclaration(declaration))
    ) {
      if (declaration.body) proofs?.push({ node: declaration, bindings: parameterBindings })
      return declaration.body ? [declaration] : []
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer)
      return [
        declaration,
        ...handlerNodes(
          declaration.initializer,
          checker,
          parameterBindings,
          active,
          staticProof,
          proofs,
          stableBindings,
          executableReturns,
        ),
      ]
    return []
  })
}
