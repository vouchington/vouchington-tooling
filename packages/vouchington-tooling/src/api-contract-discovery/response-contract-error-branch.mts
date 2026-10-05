import ts from '../contract-schema/typescript-api.mts'

import { isContextMethod } from './response-contract-route-analysis.mts'
import { unwrapTransparentExpression } from './response-contract-route-syntax.mts'
import { responseBodyExpression } from './response-contract-registration.mts'

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
export function isInErrorBranch(
  call: ts.CallExpression,
  excludeDynamicErrorObjects = false,
): boolean {
  let statement: ts.Node = call
  while (!ts.isStatement(statement)) statement = statement.parent
  if (!excludeDynamicErrorObjects) return precededByErrorStatus(statement)
  const latestStatus = latestStatusSetter(statement)
  if (!latestStatus) return false
  if (isBareErrorStatusStatement(latestStatus, true)) return true
  return isErrorObjectJson(call) && isDynamicStatusStatement(latestStatus)
}

/**
 * Walks outward through enclosing blocks so a `ctx.setStatus(>=400)` set before the branch's own
 * containing statement — not just a direct sibling in the same block — still marks the branch as
 * an error path. Needed for a shared helper like `data-request.mts`'s `sendActiveRequestConflict`,
 * which sets one error status up front, then branches into two differently-shaped `ctx.json`
 * bodies nested one block deeper.
 */
function precededByErrorStatus(statement: ts.Statement): boolean {
  return precededByStatus(statement, isBareErrorStatusStatement)
}

function precededByStatus(
  statement: ts.Statement,
  matches: (statement: ts.Statement) => boolean,
): boolean {
  const block = statement.parent
  if (!ts.isBlock(block)) return false
  const index = block.statements.indexOf(statement)
  if (block.statements.slice(0, index).some(matches)) return true
  const enclosing = block.parent
  return ts.isStatement(enclosing) ? precededByStatus(enclosing, matches) : false
}

type StatusSetterStatement = ts.ExpressionStatement & { expression: ts.CallExpression }

function latestStatusSetter(statement: ts.Statement): StatusSetterStatement | undefined {
  const block = statement.parent
  if (!ts.isBlock(block)) return undefined
  const index = block.statements.indexOf(statement)
  for (let previous = index - 1; previous >= 0; previous--) {
    const candidate = block.statements[previous]!
    if (isStatusSetterStatement(candidate)) return candidate
    if (mayConditionallySetStatus(candidate)) return undefined
  }
  const enclosing = block.parent
  return ts.isStatement(enclosing) ? latestStatusSetter(enclosing) : undefined
}

function mayConditionallySetStatus(statement: ts.Statement): boolean {
  if (
    !ts.isIfStatement(statement) &&
    !ts.isSwitchStatement(statement) &&
    !ts.isTryStatement(statement) &&
    !ts.isForStatement(statement) &&
    !ts.isForInStatement(statement) &&
    !ts.isForOfStatement(statement) &&
    !ts.isWhileStatement(statement) &&
    !ts.isDoStatement(statement)
  )
    return false
  let found = false
  const inspect = (node: ts.Node): void => {
    if (node !== statement && isNestedFunction(node)) return
    if (ts.isCallExpression(node) && isContextMethod(node.expression, 'setStatus')) found = true
    ts.forEachChild(node, inspect)
  }
  inspect(statement)
  return found
}

function isNestedFunction(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  )
}

function isStatusSetterStatement(statement: ts.Statement): statement is StatusSetterStatement {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    isContextMethod(statement.expression.expression, 'setStatus')
  )
}

function isDynamicStatusStatement(statement: StatusSetterStatement): boolean {
  const status = statement.expression.arguments[0]
  return !!status && !ts.isNumericLiteral(unwrapTransparentExpression(status))
}

function isErrorObjectJson(call: ts.CallExpression): boolean {
  const body = responseBodyExpression(call, true)
  const errorObject = body && unwrapTransparentExpression(body)
  return (
    !!errorObject &&
    ts.isObjectLiteralExpression(errorObject) &&
    errorObject.properties.some((property) => {
      if (ts.isSpreadAssignment(property) || ts.isMethodDeclaration(property)) return false
      // Every remaining object-literal member has a name; spread members were excluded above.
      const name = property.name!
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text === 'error'
      if (!ts.isComputedPropertyName(name)) return false
      const key = unwrapTransparentExpression(name.expression)
      return ts.isStringLiteral(key) && key.text === 'error'
    })
  )
}

function isBareErrorStatusStatement(statement: ts.Statement, unwrapStatus = false): boolean {
  if (!ts.isExpressionStatement(statement)) return false
  const expression = statement.expression
  if (!ts.isCallExpression(expression) || !isContextMethod(expression.expression, 'setStatus'))
    return false
  const statusArgument = expression.arguments[0]
  const status =
    statusArgument && (unwrapStatus ? unwrapTransparentExpression(statusArgument) : statusArgument)
  return !!status && ts.isNumericLiteral(status) && Number(status.text) >= 400
}
