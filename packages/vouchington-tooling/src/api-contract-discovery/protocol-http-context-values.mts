import ts from '../contract-schema/typescript-api.mts'
import { callbackArgumentBindings } from './protocol-callback-argument-bindings.mts'
import {
  createProtocolCallbackValueResolver,
  isProtocolCallbackFunction,
  protocolCallbackHasWrittenBindings,
  type CallbackBindings,
} from './protocol-callback-values.mts'
import { returnedExpressions, returnsOnEveryPath } from './registered-route-factory-returns.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { createContextValueStability } from './protocol-http-context-value-stability.mts'

import type { ContextValues } from './protocol-http-context-value-types.mts'
import { contextProperty } from './protocol-http-context-properties.mts'
/** All possible concrete values must be retained; null denotes a proven absent value. */
export function createHttpContextValueResolver(checker: ts.TypeChecker) {
  const callbacks = createProtocolCallbackValueResolver(checker)
  const stable = createContextValueStability(checker)
  function declaration(
    target: ts.Symbol,
    env: CallbackBindings,
    seen: Set<ts.Node>,
  ): ContextValues {
    if (!stable(target)) return undefined
    const bound = env.get(target)
    if (bound) return resolve(bound.node, bound.env, seen)
    const node = target.valueDeclaration!
    if (seen.has(node)) return undefined
    if (isProtocolCallbackFunction(node) && node.body) return [{ node, env }]
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      return resolve(node.initializer, env, new Set(seen).add(node))
    }
    return undefined
  }
  function combine(
    nodes: readonly ts.Node[],
    env: CallbackBindings,
    seen: Set<ts.Node>,
  ): ContextValues {
    const rows = nodes.map((node) => resolve(node, env, new Set(seen)))
    return rows.some((row) => row === undefined) ? undefined : rows.flatMap((row) => row ?? [])
  }
  function factory(
    call: ts.CallExpression,
    env: CallbackBindings,
    seen: Set<ts.Node>,
  ): ContextValues {
    const targets = resolve(call.expression, env, new Set(seen))
    if (!targets?.length) return undefined
    const rows = targets.map((target) => {
      if (
        !target ||
        !isProtocolCallbackFunction(target.node) ||
        !target.node.body ||
        target.node.asteriskToken ||
        protocolCallbackHasWrittenBindings(target.node, checker) ||
        target.node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
        !returnsOnEveryPath(target.node.body)
      )
        return undefined
      const bindings = callbackArgumentBindings(
        target.node,
        call,
        env,
        target.env,
        checker,
        callbacks,
      )
      const values = returnedExpressions(target.node)
      if (!bindings || values.some((value) => !value)) return undefined
      return combine(values as ts.Expression[], bindings, seen)
    })
    return rows.some((row) => row === undefined) ? undefined : rows.flatMap((row) => row ?? [])
  }
  function resolve(node: ts.Node, env: CallbackBindings, seen = new Set<ts.Node>()): ContextValues {
    if (ts.isExpression(node)) node = unwrapExpression(node)
    if (seen.has(node)) return undefined
    const next = new Set(seen).add(node)
    if (node.kind === ts.SyntaxKind.NullKeyword) return [null]
    if (
      isProtocolCallbackFunction(node) ||
      ts.isObjectLiteralExpression(node) ||
      ts.isStringLiteral(node) ||
      node.kind === ts.SyntaxKind.TrueKeyword ||
      node.kind === ts.SyntaxKind.FalseKeyword
    )
      return [{ node, env }]
    if (ts.isIdentifier(node)) {
      const target = callbacks.symbol(node)
      if (node.text === 'undefined' && !target?.valueDeclaration) return [null]
      return target ? declaration(target, env, next) : undefined
    }
    if (ts.isConditionalExpression(node)) {
      const conditions = resolve(node.condition, env, new Set(next))
      const truth =
        conditions?.length &&
        conditions.every((value) => value?.node.kind === ts.SyntaxKind.TrueKeyword)
      const falsity =
        conditions?.length &&
        conditions.every((value) => value?.node.kind === ts.SyntaxKind.FalseKeyword)
      return combine(
        truth ? [node.whenTrue] : falsity ? [node.whenFalse] : [node.whenTrue, node.whenFalse],
        env,
        next,
      )
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const left = resolve(node.left, env, new Set(next))
      if (!left) return undefined
      if (!left.includes(null)) return left
      const right = resolve(node.right, env, new Set(next))
      return right ? [...left.filter((value) => value !== null), ...right] : undefined
    }
    if (ts.isCallExpression(node)) return factory(node, env, next)
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const owners = resolve(node.expression, env, new Set(next))
      const keys = ts.isPropertyAccessExpression(node)
        ? [{ node: node.name, env }]
        : node.argumentExpression && resolve(node.argumentExpression, env, new Set(next))
      if (
        !owners ||
        !keys ||
        keys.some((key) => !key || !(ts.isIdentifier(key.node) || ts.isStringLiteral(key.node)))
      )
        return undefined
      const rows = owners.flatMap((owner) =>
        keys.map(
          (key) =>
            owner &&
            key &&
            contextProperty(
              owner,
              (key.node as ts.Identifier | ts.StringLiteral).text,
              new Set(next),
              { resolve, declaration, checker },
            ),
        ),
      )
      return rows.some((row) => row === undefined)
        ? undefined
        : rows.flatMap((row) => row?.map((property) => property.value) ?? [null])
    }
    return undefined
  }
  return { resolve, callbacks }
}
