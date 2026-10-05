import ts from '../contract-schema/typescript-api.mts'
import { followedImplementations, type Scope } from './request-validation-follow.mts'
import { bindArguments } from './request-validation-trace.mts'
import { returnedValues } from './request-validation-trace-helpers.mts'
import { emptyState, type WalkState } from './request-validation-state-key.mts'

/**
 * Finds configured factory calls in registration-time expressions, without entering handlers.
 * Validators evaluated here run while the handler is built, not per request, so only the walk of
 * the handler itself reports them.
 */
export function createRegistrationScanner(
  scopeOf: (state: WalkState) => Scope,
  reportFactory: (call: ts.CallExpression, state: WalkState) => boolean,
) {
  const scanning = new Set<ts.Node>()
  function scan(node: ts.Node, state: WalkState = emptyState) {
    if (ts.isFunctionLike(node)) return
    if (ts.isCallExpression(node) && reportFactory(node, state)) return
    if (ts.isCallExpression(node))
      // A helper that builds the handler: follow its returned values with bound arguments.
      for (const fn of followedImplementations(node, scopeOf(state))) {
        if (scanning.has(fn)) continue
        scanning.add(fn)
        const { keys, roots } = bindArguments(fn, node, scopeOf(state))
        for (const value of returnedValues(fn)) scan(value, { ...state, keys, roots })
        scanning.delete(fn)
      }
    ts.forEachChild(node, (child) => scan(child, state))
  }
  return scan
}
