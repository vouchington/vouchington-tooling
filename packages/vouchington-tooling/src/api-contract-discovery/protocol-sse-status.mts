import ts from '../contract-schema/typescript-api.mts'
import { executableProtocolPath } from './protocol-execution-path.mts'
import { unsupportedContextAlias, unsupportedContextAssignment } from './protocol-context-alias.mts'
import { contextResponseMethod } from './protocol-http-emission.mts'
import { enclosingFunction, unwrapExpression } from './protocol-marker-analysis.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { statusCanPrecede } from './protocol-sse-feasible-status.mts'
import { statusDominatesEmission, unconditionalStatusSetter } from './protocol-status-dominance.mts'
import { visit } from './response-contract-route-analysis.mts'
import { resolveEmissionStatus } from './response-contract-status.mts'

export function resolveSseStatus(
  paths: readonly (readonly (ts.CallExpression | ts.NewExpression)[])[],
  functions: readonly ts.FunctionLikeDeclaration[],
  contexts: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker,
): ReturnType<typeof resolveEmissionStatus> {
  const matches = (expression: ts.Expression) =>
    [...contexts].some(
      (context) => contextResponseMethod(expression, context, checker) === 'setStatus',
    )
  const setters = new Set<ts.CallExpression>()
  for (const fn of functions)
    visit(fn, (node) => {
      if (!executableProtocolPath(node, checker)) return
      if (
        [...contexts].some(
          (context) =>
            (ts.isVariableDeclaration(node) && unsupportedContextAlias(node, context, checker)) ||
            unsupportedContextAssignment(node, context, checker),
        )
      )
        throw new Error('SSE context has an unsupported mutable or destructured alias')
      if (ts.isCallExpression(node) && indirectSetter(node.expression, contexts, checker))
        throw new Error('SSE context uses an unsupported indirect status setter')
      if (ts.isCallExpression(node) && matches(node.expression)) setters.add(node)
    })
  const statuses = paths.map((path) => {
    for (const setter of setters) {
      const anchors = path.filter(
        (anchor) => enclosingFunction(anchor) === enclosingFunction(setter),
      )
      if (
        (!anchors.length || anchors.some((anchor) => statusCanPrecede(setter, anchor))) &&
        !anchors.some((anchor) => statusDominatesEmission(anchor, new Set([setter])))
      )
        throw new Error('SSE status does not dominate its frame emission')
    }
    for (const anchor of path) {
      const setter = nearestSetter(anchor, setters)
      if (setter) {
        const status = resolveEmissionStatus(setter, matches)
        if (status.unavailableReason) throw new Error(status.unavailableReason)
        return status
      }
    }
    return { statusKnowledge: 'default' as const }
  })
  if (statuses.every((status) => status.statusKnowledge === 'default'))
    return { statusKnowledge: 'default' }
  const codes = [...new Set(statuses.flatMap((status) => status.statusCodes ?? [200]))].toSorted(
    (a, b) => a - b,
  ) as [number, ...number[]]
  if (codes.some((code) => !Number.isInteger(code) || code < 100 || code > 599))
    throw new Error('SSE status must be an integer from 100 through 599')
  return { statusKnowledge: 'explicit', statusCodes: codes }
}

function indirectSetter(
  expression: ts.Expression,
  contexts: ReadonlySet<ts.Symbol>,
  checker: ts.TypeChecker,
): boolean {
  const access = unwrapExpression(expression)
  const name = ts.isPropertyAccessExpression(access)
    ? access.name.text
    : ts.isElementAccessExpression(access) && ts.isStringLiteral(access.argumentExpression)
      ? access.argumentExpression.text
      : undefined
  if (!name || !['call', 'apply', 'bind'].includes(name)) return false
  const target = (access as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression
  if (
    [...contexts].some((context) => contextResponseMethod(target, context, checker) === 'setStatus')
  )
    return true
  const receiver = expressionReceiver(target, checker)
  return !!receiver && contexts.has(receiver.root) && receiver.path[0] === 'setStatus'
}

function nearestSetter(
  anchor: ts.Node,
  setters: ReadonlySet<ts.CallExpression>,
): ts.CallExpression | undefined {
  let current = anchor
  while (current.parent && !ts.isFunctionLike(current.parent)) {
    const parent = current.parent
    if (ts.isBlock(parent)) {
      const index = parent.statements.indexOf(current as ts.Statement)
      for (const statement of parent.statements.slice(0, index).toReversed()) {
        const setter = unconditionalStatusSetter(statement, setters)
        if (setter) return setter
      }
    }
    current = parent
  }
  return undefined
}
