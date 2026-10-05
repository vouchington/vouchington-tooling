import {
  opaqueHttpContextConstruction,
  httpHandlerContext,
  contextResponseMethod,
  httpContextArgument,
  wrappedHttpContextArgument,
} from './protocol-http-context.mts'
import { unsupportedContextAlias, unsupportedContextAssignment } from './protocol-context-alias.mts'
import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { returnedExpressions } from './registered-route-factory-returns.mts'
import { mutatesHttpResponseMethod } from './protocol-http-method-mutations.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'

/** Source mutations and constructor escapes invalidate the same caller-bound context proof. */
export function unsupportedBoundContextNode(
  node: ts.Node,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  handler: ts.FunctionLikeDeclaration,
): boolean {
  const returned =
    ts.isReturnStatement(node) || ts.isYieldExpression(node)
      ? node.expression
      : ts.isArrowFunction(handler) && handler.body === node && ts.isExpression(node)
        ? node
        : undefined
  const invoked = ts.isCallExpression(node)
    ? unwrapExpression(node.expression)
    : ts.isTaggedTemplateExpression(node)
      ? unwrapExpression(node.tag)
      : undefined
  return (
    (invoked &&
      ts.isElementAccessExpression(invoked) &&
      !ts.isStringLiteral(invoked.argumentExpression) &&
      httpContextArgument(invoked.expression, context, checker) &&
      executableProtocolPath(node, checker, handler)) ||
    (!!returned &&
      executableProtocolPath(node, checker, handler) &&
      (httpContextArgument(returned, context, checker) ||
        wrappedHttpContextArgument(returned, context, checker))) ||
    unsupportedContextAssignment(node, context, checker) ||
    (ts.isVariableDeclaration(node) && unsupportedContextAlias(node, context, checker)) ||
    mutatesHttpResponseMethod(node, context, checker, handler) ||
    (ts.isIdentifier(node) &&
      node.text === 'arguments' &&
      !ts.isArrowFunction(handler) &&
      enclosingFunction(node) === handler &&
      executableProtocolPath(node, checker, handler)) ||
    opaqueHttpContextConstruction(node, checker, context, handler) ||
    (ts.isTaggedTemplateExpression(node) &&
      executableProtocolPath(node, checker, handler) &&
      (['json', 'pipeline', 'setStatus', 'response.buffer', 'response.empty'].includes(
        contextResponseMethod(node.tag, context, checker, true) ?? '',
      ) ||
        (ts.isTemplateExpression(node.template) &&
          node.template.templateSpans.some(
            (span) =>
              httpContextArgument(span.expression, context, checker) ||
              wrappedHttpContextArgument(span.expression, context, checker),
          ))))
  )
}

/** An already-resolved factory return keeps the selected handler's own status collector. */
function returnedContextHandler(fn: ts.FunctionLikeDeclaration, checker: ts.TypeChecker): boolean {
  const owner = enclosingFunction(fn)
  return (
    !!owner &&
    returnedExpressions(owner).some((value) => {
      if (!value) return false
      const expression = unwrapExpression(value)
      if (expression === fn) return true
      const declaration = ts.isIdentifier(expression)
        ? checker.getSymbolAtLocation(expression)?.valueDeclaration
        : undefined
      return (
        declaration === fn ||
        (!!declaration &&
          ts.isVariableDeclaration(declaration) &&
          !!declaration.initializer &&
          unwrapExpression(declaration.initializer) === fn)
      )
    })
  )
}

/** Canonical scopes and the selected returned handler retain their existing status collection. */
export function uncollectedContextMethod(
  node: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
  fn: ts.FunctionLikeDeclaration,
  call: { selected: boolean; direct: boolean },
): boolean {
  const method = contextResponseMethod(node.expression, context, checker, true)
  const first = runtimeParameters(fn)[0]?.name
  const direct =
    call.direct && first && ts.isIdentifier(first) && checker.getSymbolAtLocation(first) === context
  return (
    ['json', 'pipeline', 'response.buffer', 'setStatus'].includes(method ?? '') &&
    (method !== 'setStatus' ||
      (httpHandlerContext(fn, checker) !== context &&
        !direct &&
        !(call.selected && returnedContextHandler(fn, checker))))
  )
}

/** The implemented call retains direct canonical context parameters and rejects destructuring. */
export function boundHttpContexts(
  fn: ts.FunctionLikeDeclaration,
  call: ts.CallExpression,
  context: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Symbol[] | undefined {
  const contexts = [context]
  for (const [index, parameter] of runtimeParameters(fn).entries()) {
    const argument = call.arguments[index]
    if (!argument || !httpContextArgument(argument, context, checker)) continue
    if (!ts.isIdentifier(parameter.name) || parameter.dotDotDotToken) return undefined
    contexts.push(checker.getSymbolAtLocation(parameter.name)!)
  }
  return contexts
}

/** An actual generator invocation retains the capabilities its iterator can yield. */
export function yieldsBoundHttpContext(
  fn: ts.FunctionLikeDeclaration,
  context: ts.Symbol,
  checker: ts.TypeChecker,
): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (ts.isFunctionLike(node)) return
    if (ts.isYieldExpression(node) && node.expression && potentiallyExecuted(node))
      found ||=
        httpContextArgument(node.expression, context, checker) ||
        wrappedHttpContextArgument(node.expression, context, checker)
    ts.forEachChild(node, visit)
  }
  if (fn.asteriskToken && fn.body) visit(fn.body)
  return found
}
