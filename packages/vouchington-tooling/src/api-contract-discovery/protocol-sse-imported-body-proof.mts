import {
  selectedSseBodyReceivers,
  selectedSseBodyMutation,
  containsSelectedSseValue,
} from './protocol-sse-imported-selection.mts'
import { selectedSseExpression } from './protocol-sse-selected-expression.mts'
import ts from '../contract-schema/typescript-api.mts'
import { unwrapExpression } from './protocol-marker-analysis.mts'
import { runtimeParameters } from './registered-route-runtime-parameters.mts'
import { sseWriteInvocation } from './protocol-sse-write-access.mts'
import {
  expressionReceiver,
  sameWriteReceiver,
  type WriteReceiver,
} from './protocol-write-receiver.mts'
type Owner = {
  fn: ts.FunctionLikeDeclaration
  call: ts.CallExpression
  root: ts.CallExpression
  context?: ts.Symbol
}
type CanonicalCall = (node: ts.CallExpression, receiver: WriteReceiver, owner: Owner) => boolean
export function createImportedSseBodyProof(
  checker: ts.TypeChecker,
  implementationCall: (call: ts.CallExpression) => ts.Node | undefined,
  canonicalCall: CanonicalCall,
): (
  call: ts.CallExpression,
  selectedArgumentIndices: readonly number[],
  selectedReturnedProperties?: readonly string[],
  selectedCapturedReceivers?: readonly WriteReceiver[],
) => boolean {
  function prove(
    call: ts.CallExpression,
    indices: readonly number[],
    properties: readonly string[],
    captured: readonly WriteReceiver[],
    root: ts.CallExpression,
    active: ReadonlySet<ts.FunctionLikeDeclaration>,
  ): boolean {
    const node = implementationCall(call)
    const fn = node && ts.isFunctionLike(node) && 'body' in node && node.body ? node : undefined
    if (!fn || active.has(fn)) return false
    const parameters = runtimeParameters(fn)
    const selected =
      selectedSseBodyReceivers(fn, call, indices, properties, captured, checker) ?? []
    if (!selected.length) return false
    const next = new Set(active).add(fn)
    const firstParameter = parameters[0]?.name
    const context =
      firstParameter && ts.isIdentifier(firstParameter)
        ? checker.getSymbolAtLocation(firstParameter)
        : undefined
    const owner: Owner = { fn, call, root, ...(context ? { context } : {}) }
    const matches = (expression: ts.Expression): WriteReceiver | undefined => {
      const receiver = expressionReceiver(expression, checker)
      return receiver && selected.find((value) => sameWriteReceiver(value, receiver))
    }
    const touches = (expression: ts.Expression): boolean =>
      selectedSseExpression(expression, (value) => {
        const receiver = expressionReceiver(value, checker)
        return (
          !!receiver &&
          selected.some(
            (value) =>
              receiver.root === value.root &&
              value.path.every((part, index) => receiver.path[index] === part),
          )
        )
      })
    const contains = (expression: ts.Expression): boolean =>
      containsSelectedSseValue(expression, checker, matches, touches)
    let safe = true
    function walk(node: ts.Node, enclosing: ts.FunctionLikeDeclaration): void {
      if (!safe) return
      if (ts.isFunctionLike(node) && node !== fn) {
        if ('body' in node && node.body) {
          if (ts.isExpression(node.body) && contains(node.body)) safe = false
          else walk(node.body, node)
        }
        return
      }
      if (ts.isVariableDeclaration(node) && node.initializer && contains(node.initializer)) {
        const symbol = checker.getSymbolAtLocation(node.name)
        if (
          !symbol ||
          !ts.isIdentifier(node.name) ||
          !ts.isIdentifier(unwrapExpression(node.initializer))
        ) {
          safe = false
          return
        }
        selected.push({ root: symbol, path: [] })
      }
      if (
        ts.isReturnStatement(node) &&
        node.expression &&
        contains(node.expression) &&
        (enclosing !== fn || properties.length === 0)
      )
        safe = false
      if (selectedSseBodyMutation(node, touches, contains)) safe = false
      if (!safe) return
      if (ts.isCallExpression(node)) {
        const access = sseWriteInvocation(node, checker)
        const written = access?.receiver && matches(access.receiver)
        const passed = node.arguments.flatMap((argument, index) =>
          contains(argument) ? [index] : [],
        )
        if (written || passed.length > 0 || touches(node.expression)) {
          const exact =
            written ?? passed.map((index) => matches(node.arguments[index]!)).find(Boolean)
          const canonical = exact && canonicalCall(node, exact, owner)
          const emptyEnd = written && access?.method === 'end' && !access.rawBytes && !passed.length
          if (
            !canonical &&
            !emptyEnd &&
            (passed.length === 0 ||
              passed.some((index) => !matches(node.arguments[index]!)) ||
              !prove(node, passed, [], [], root, next))
          ) {
            safe = false
            return
          }
        }
      }
      ts.forEachChild(node, (child) => walk(child, enclosing))
    }
    walk(fn.body!, fn)
    return safe
  }
  return (call, indices, properties = [], captured = []) =>
    prove(call, indices, properties, captured, call, new Set())
}
