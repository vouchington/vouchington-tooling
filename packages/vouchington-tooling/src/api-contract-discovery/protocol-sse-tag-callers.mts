import ts from '../contract-schema/typescript-api.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction,
} from './protocol-callback-values.mts'
import { implementationDeclaration } from './protocol-sse-implementation.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import {
  enclosingRouteBinding,
  type HandlerBindings,
  type RouteBinding,
} from './response-contract-route-analysis.mts'

/** Associates only actual executable concrete tags with their registered caller route. */
export function createSseTagCallers(
  tags: readonly ts.TaggedTemplateExpression[],
  checker: ts.TypeChecker,
  bindings: HandlerBindings,
  files: readonly ts.SourceFile[],
): (fn: ts.FunctionLikeDeclaration) => readonly RouteBinding[] {
  const sources = new Set(files)
  const resolver = createProtocolCallbackValueResolver(checker)
  const callers = new Map<ts.FunctionLikeDeclaration, RouteBinding[]>()
  for (const tag of tags) {
    if (!executableProtocolPath(tag, checker)) continue
    const fn =
      implementationDeclaration(checker.getResolvedSignature(tag)?.declaration, checker) ??
      resolver.resolve(tag.tag, new Map())?.node
    if (
      !fn ||
      !isProtocolCallbackFunction(fn) ||
      !fn.body ||
      fn.asteriskToken ||
      !sources.has(fn.getSourceFile())
    )
      continue
    const binding = enclosingRouteBinding(tag, checker, bindings, false)
    if (!binding) continue
    const values = callers.get(fn) ?? []
    values.push(binding)
    callers.set(fn, values)
  }
  return (fn) => callers.get(fn) ?? []
}

/** Concrete indexed tag bodies exclude their receiver only when they never observe this. */
export function sseTagExcludesReceiver(
  tag: ts.TaggedTemplateExpression,
  checker: ts.TypeChecker,
  files: readonly ts.SourceFile[],
): boolean {
  const fn = implementationDeclaration(checker.getResolvedSignature(tag)?.declaration, checker)
  if (!fn || !('body' in fn) || !fn.body || !files.includes(fn.getSourceFile())) return false
  function observesThis(node: ts.Node): boolean {
    return node.kind === ts.SyntaxKind.ThisKeyword || node.forEachChild(observesThis) === true
  }
  return !observesThis(fn.body)
}
