import ts from '../contract-schema/typescript-api.mts'

import { isContextMethod } from './response-contract-route-analysis.mts'

/**
 * Detects a hand-rolled early-return error guard: `ctx.setStatus(NNN >= 400)` followed by a
 * response body call in the same block (e.g. `auth-me.mts`'s `ctx.setStatus(401); return
 * ctx.json({error})` before its `ctx.json({user})` success body). Skipping these keeps the
 * bare implicit key free for the route's actual success body instead of locking onto whichever
 * error branch happens to appear first in document order.
 *
 * Deliberately narrow: only a *direct* sibling `ExpressionStatement` counts, not a nested one
 * inside an earlier sibling's own subtree (e.g. inside an earlier, unrelated `if` guard's own
 * block). Recursing into nested subtrees would flag a trailing success statement that follows
 * two independent, self-contained early-return guards, even though neither guard's error status
 * is in effect on the path that reaches the trailing statement.
 */
export function isInErrorBranch(call: ts.CallExpression): boolean {
  let statement: ts.Node = call
  while (!ts.isStatement(statement)) statement = statement.parent
  return precededByErrorStatus(statement as ts.Statement)
}

/**
 * Walks outward through enclosing blocks so a `ctx.setStatus(>=400)` set before the branch's own
 * containing statement — not just a direct sibling in the same block — still marks the branch as
 * an error path. Needed for a shared helper like `data-request.mts`'s `sendActiveRequestConflict`,
 * which sets one error status up front, then branches into two differently-shaped `ctx.json`
 * bodies nested one block deeper.
 */
function precededByErrorStatus(statement: ts.Statement): boolean {
  const block = statement.parent
  if (!ts.isBlock(block)) return false
  const index = block.statements.indexOf(statement)
  if (block.statements.slice(0, index).some(isBareErrorStatusStatement)) return true
  const enclosing = block.parent
  return ts.isStatement(enclosing) ? precededByErrorStatus(enclosing) : false
}

function isBareErrorStatusStatement(statement: ts.Statement): boolean {
  if (!ts.isExpressionStatement(statement)) return false
  const expression = statement.expression
  if (!ts.isCallExpression(expression) || !isContextMethod(expression.expression, 'setStatus'))
    return false
  const statusArgument = expression.arguments[0]
  return (
    !!statusArgument && ts.isNumericLiteral(statusArgument) && Number(statusArgument.text) >= 400
  )
}
