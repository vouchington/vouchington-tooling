import ts from '../contract-schema/typescript-api.mts'
import { callbackOptionsEscape } from './protocol-callback-mutations.mts'
import { isSupportedProtocolCallback } from './protocol-callback-invocation.mts'
import { potentiallyExecuted } from './protocol-executable-path.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction as functionNode,
  type CallbackBindings,
} from './protocol-callback-values.mts'

type FunctionNode = ts.FunctionLikeDeclaration
type ImplementedFunction = FunctionNode & { body: ts.ConciseBody }

function implementedFunction(node: ts.Node): node is ImplementedFunction {
  return functionNode(node) && !!node.body
}

/** Proves an executable lexical path containing at least one opaque callback escape. */
export function opaqueProtocolCallbackPath(node: ts.Node, checker: ts.TypeChecker): boolean {
  if (!potentiallyExecuted(node)) return false
  const functions: FunctionNode[] = []
  for (let fn = enclosingFunction(node); fn; fn = enclosingFunction(fn)) functions.push(fn)
  if (
    !functions.length ||
    functions.some((fn) => !fn.body || fn.asteriskToken || !potentiallyExecuted(fn))
  )
    return false
  let opaque = false
  for (const fn of functions) {
    if (isSupportedProtocolCallback(fn, checker)) continue
    if (!escapesToOpaque(fn, checker)) return false
    opaque = true
  }
  return opaque
}

function escapesToOpaque(callback: FunctionNode, checker: ts.TypeChecker): boolean {
  const resolver = createProtocolCallbackValueResolver(checker)
  function opaque(call: ts.CallExpression | ts.NewExpression, env: CallbackBindings): boolean {
    const implementation = resolver.resolve(call.expression, env)
    if (implementation && functionNode(implementation.node) && implementation.node.body)
      return false
    const declaration = checker.getResolvedSignature(call)?.declaration
    return !declaration || !('body' in declaration && declaration.body)
  }
  function executableCallsite(call: ts.CallExpression | ts.NewExpression): boolean {
    const callbackAncestors = new Set<FunctionNode>()
    for (let fn = enclosingFunction(callback); fn; fn = enclosingFunction(fn))
      callbackAncestors.add(fn)
    for (let fn = enclosingFunction(call); fn; fn = enclosingFunction(fn))
      if (
        !fn.body ||
        fn.asteriskToken ||
        !potentiallyExecuted(fn) ||
        (!callbackAncestors.has(fn) && !isSupportedProtocolCallback(fn, checker))
      )
        return false
    return true
  }
  function scanBody(
    fn: FunctionNode & { body: ts.ConciseBody },
    env: CallbackBindings,
    active: Set<FunctionNode>,
  ): boolean {
    const chain = new Set([...active, fn])
    let escaped = false
    function visit(node: ts.Node) {
      if (escaped || !potentiallyExecuted(node)) return
      if (ts.isFunctionLike(node)) return
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const forwards = callbackOptionsEscape(node, env, callback, resolver)
        if (forwards && opaque(node, env)) {
          escaped = true
          return
        }
        const target = forwards ? resolver.resolve(node.expression, env) : undefined
        if (
          target &&
          implementedFunction(target.node) &&
          !target.node.asteriskToken &&
          !chain.has(target.node)
        ) {
          const next = callbackArgumentBindings(
            target.node,
            node,
            env,
            target.env,
            checker,
            resolver,
          )
          if (!next || scanBody(target.node, next, chain)) escaped = true
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(fn.body)
    return escaped
  }
  function sourceCalls(source: ts.SourceFile): boolean {
    let escaped = false
    function visit(node: ts.Node) {
      if (escaped || !potentiallyExecuted(node)) return
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (!executableCallsite(node)) return
        const forwards = callbackOptionsEscape(node, new Map(), callback, resolver)
        if (forwards && opaque(node, new Map())) {
          escaped = true
          return
        }
        const target = forwards ? resolver.resolve(node.expression, new Map()) : undefined
        if (target && implementedFunction(target.node) && !target.node.asteriskToken) {
          const next = callbackArgumentBindings(
            target.node,
            node,
            new Map(),
            target.env,
            checker,
            resolver,
          )
          if (!next || scanBody(target.node, next, new Set())) escaped = true
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return escaped
  }
  return sourceCalls(callback.getSourceFile())
}
