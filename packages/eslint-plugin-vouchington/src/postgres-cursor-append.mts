import { propertyName, type NodeLike } from './ast-helpers.mts'

type TransparentParent = (node: NodeLike) => NodeLike

export function isDiscardedSqlStatementAppend(
  identifier: NodeLike,
  helpers: { propertyName: typeof propertyName },
  transparentParent: TransparentParent,
): boolean {
  let call = appendCall(identifier, helpers, transparentParent)
  while (call) {
    const result = transparentParent(call)
    if (result.parent?.type === 'ExpressionStatement') return true
    call = appendCall(call, helpers, transparentParent)
  }
  return false
}

function appendCall(
  node: NodeLike,
  helpers: { propertyName: typeof propertyName },
  transparentParent: TransparentParent,
): NodeLike | null {
  const object = transparentParent(node)
  const member = object.parent
  if (member?.type !== 'MemberExpression' || member.object !== object) return null
  if (member.computed || helpers.propertyName(member) !== 'append') return null
  const callee = transparentParent(member)
  const call = callee.parent
  return call?.type === 'CallExpression' && call.callee === callee ? call : null
}
