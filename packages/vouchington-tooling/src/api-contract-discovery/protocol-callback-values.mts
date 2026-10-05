import ts from '../contract-schema/typescript-api.mts'
import { registeredHandler } from './protocol-callback-registration.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { hasBindingWrite } from './registered-route-binding-writes.mts'
import type { ProtocolCache } from './protocol-analysis-cache.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'

type FunctionNode = ts.FunctionLikeDeclaration
export type CallbackValue = { node: ts.Node; env: CallbackBindings }
export type CallbackBindings = ReadonlyMap<ts.Symbol, CallbackValue>
export function isProtocolCallbackFunction(node: ts.Node): node is FunctionNode {
  return ts.isFunctionLike(node) && 'body' in node
}
/** Resolves stable named uses in outer statements and directly registered inline handlers. */
export function protocolCallbackSourceCalls(fn: FunctionNode): ts.CallExpression[] {
  const declaration = fn.parent
  if (
    !ts.isFunctionDeclaration(fn) &&
    (!ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name) ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      !(declaration.parent.flags & ts.NodeFlags.Const))
  )
    return []
  const calls: ts.CallExpression[] = []
  function visit(node: ts.Node) {
    if (
      isProtocolCallbackFunction(node) &&
      !(
        ts.isCallExpression(node.parent) &&
        registeredHandler(node.parent) &&
        node.parent.arguments.includes(node as ts.Expression)
      )
    )
      return
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(fn.getSourceFile())
  return calls
}
function literalName(node: ts.PropertyName): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined
}

export function createProtocolCallbackValueResolver(checker: ts.TypeChecker) {
  function symbol(node: ts.Node) {
    const found = checker.getSymbolAtLocation(node)
    return found?.flags && found.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(found)
      : found
  }
  function property(
    value: CallbackValue | undefined,
    name: string,
    seen: Set<ts.Node>,
  ): CallbackValue | undefined {
    if (
      !value ||
      !ts.isObjectLiteralExpression(value.node) ||
      value.node.properties.some(ts.isSpreadAssignment)
    )
      return undefined
    const member = value.node.properties.find(
      (item) => item.name && literalName(item.name) === name,
    )
    if (member && ts.isPropertyAssignment(member))
      return resolve(member.initializer, value.env, seen)
    if (member && ts.isShorthandPropertyAssignment(member)) {
      const target = checker.getShorthandAssignmentValueSymbol(member)
      return target ? declaration(target, value.env, seen) : undefined
    }
    return member && isProtocolCallbackFunction(member)
      ? { node: member, env: value.env }
      : undefined
  }
  function declaration(
    target: ts.Symbol,
    env: CallbackBindings,
    seen: Set<ts.Node>,
  ): CallbackValue | undefined {
    const bound = env.get(target)
    if (bound) return resolve(bound.node, bound.env, seen)
    const implemented = target.declarations?.find(
      (item) => isProtocolCallbackFunction(item) && item.body,
    )
    if (implemented) return { node: implemented, env }
    const node = target.valueDeclaration
    if (!node || seen.has(node)) return undefined
    seen.add(node)
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
    )
      return resolve(node.initializer, env, seen)
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const owner = node.parent.parent
      const name = literalName(node.propertyName ?? (node.name as ts.PropertyName))
      if (
        name &&
        ts.isVariableDeclaration(owner) &&
        owner.initializer &&
        ts.isVariableDeclarationList(owner.parent) &&
        owner.parent.flags & ts.NodeFlags.Const
      )
        return property(resolve(owner.initializer, env, seen), name, seen)
    }
    return undefined
  }
  function resolve(
    node: ts.Node,
    env: CallbackBindings,
    seen = new Set<ts.Node>(),
  ): CallbackValue | undefined {
    if (ts.isExpression(node)) node = unwrapExpression(node)
    if (seen.has(node)) return undefined
    seen.add(node)
    if (
      isProtocolCallbackFunction(node) ||
      ts.isObjectLiteralExpression(node) ||
      ts.isArrayLiteralExpression(node)
    )
      return { node, env }
    if (ts.isIdentifier(node)) {
      const target = symbol(node)
      return target ? declaration(target, env, seen) : undefined
    }
    if (ts.isPropertyAccessExpression(node)) {
      const member = property(resolve(node.expression, env, seen), node.name.text, seen)
      if (member) return member
      const target = symbol(node.name)
      return target ? declaration(target, env, seen) : undefined
    }
    return undefined
  }
  return { resolve, symbol, property }
}

export function protocolCallbackHasWrittenBindings(
  fn: FunctionNode,
  checker: ts.TypeChecker,
  cache?: ProtocolCache,
): boolean {
  return (
    (ts.isFunctionDeclaration(fn) && hasBindingWrite(fn, checker, cache)) ||
    runtimeParameters(fn).some((parameter) => hasBindingWrite(parameter, checker, cache))
  )
}
