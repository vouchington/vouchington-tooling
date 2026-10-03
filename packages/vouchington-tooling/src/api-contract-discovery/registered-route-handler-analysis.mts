import ts from '../contract-schema/typescript-api.mts'
import { returnedExpressions, returnsOnEveryPath } from './registered-route-factory-returns.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'

export type HandlerProof = {
  node: ts.FunctionLikeDeclaration
  bindings: Map<ts.Symbol, ts.Expression>
}

export function handlerNodes(
  argument: ts.Expression,
  checker: ts.TypeChecker,
  parameterBindings = new Map<ts.Symbol, ts.Expression>(),
  active = new Set<ts.Node>(),
  staticProof = false,
  proofs?: HandlerProof[],
): ts.Node[] {
  const unwrapped = unwrapHandlerExpression(argument)
  if (unwrapped !== argument)
    return handlerNodes(unwrapped, checker, parameterBindings, active, staticProof, proofs)
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
  if (bound !== argument)
    return handlerNodes(bound, checker, parameterBindings, active, staticProof, proofs)
  if (active.has(argument)) return []
  const next = new Set(active).add(argument)
  if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
    proofs?.push({ node: argument, bindings: parameterBindings })
    return [argument]
  }
  if (ts.isCallExpression(argument)) {
    const resolvedProofs: HandlerProof[] = []
    const groups = callableImplementations(argument.expression, checker, staticProof).map(
      (implementation) => {
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
        const returned = returnedExpressions(implementation)
        if (
          staticProof &&
          (!returnsOnEveryPath(implementation.body!) || returned.some((value) => !value))
        )
          return []
        const results = returned.map((value) =>
          value ? handlerNodes(value, checker, bindings, next, staticProof, resolvedProofs) : [],
        )
        return staticProof && results.some((result) => !result.some(ts.isFunctionLike))
          ? []
          : results.flat()
      },
    )
    if (staticProof && groups.some((group) => group.length === 0)) return []
    proofs?.push(...resolvedProofs)
    return groups.flat()
  }
  return declarationImplementations(argument, checker, next, staticProof, parameterBindings, proofs)
}

function callableImplementations(
  node: ts.Node,
  checker: ts.TypeChecker,
  staticProof = false,
): ts.FunctionLikeDeclaration[] {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return []
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  const implementations: ts.FunctionLikeDeclaration[] = []
  for (const declaration of resolved.declarations ?? []) {
    if (staticProof && !hasStableBinding(declaration, checker)) continue
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
): ts.Node[] {
  const symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return []
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  return (resolved.declarations ?? []).flatMap((declaration) => {
    if (staticProof && !hasStableBinding(declaration, checker)) return []
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
        ),
      ]
    return []
  })
}

function hasStableBinding(declaration: ts.Declaration, checker: ts.TypeChecker): boolean {
  if (ts.isVariableDeclaration(declaration))
    return (
      ts.isVariableDeclarationList(declaration.parent) &&
      !!(declaration.parent.flags & ts.NodeFlags.Const)
    )
  return !ts.isFunctionDeclaration(declaration) || !hasBindingWrite(declaration, checker)
}

function unwrapHandlerExpression(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression
  return node
}
