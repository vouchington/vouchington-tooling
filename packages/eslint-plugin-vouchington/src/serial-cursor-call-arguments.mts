import { propertyName, unwrap, type NodeLike } from './ast-helpers.mts'

export type CallArgument = NodeLike | null | undefined

function expandArguments(args: readonly CallArgument[]): CallArgument[] | null {
  const expanded: CallArgument[] = []
  for (const argument of args) {
    const value = unwrap(argument)
    if (value?.type !== 'SpreadElement') {
      expanded.push(value)
      continue
    }
    const iterable = unwrap(value.argument as NodeLike | undefined)
    if (iterable?.type !== 'ArrayExpression') return null
    const contents = expandArguments(iterable.elements as CallArgument[])
    if (!contents) return null
    expanded.push(...contents)
  }
  return expanded
}

export function inlineInvocation(
  callee: NodeLike | null | undefined,
  args: readonly CallArgument[],
) {
  const method = propertyName(callee)
  if (callee?.type !== 'MemberExpression' || (method !== 'call' && method !== 'apply'))
    return { callee, args: expandArguments(args) }
  const target = unwrap(callee.object as NodeLike | undefined)
  const actual = expandArguments(args)
  if (!actual) return { callee: target, args: null }
  if (method === 'call') return { callee: target, args: actual.slice(1) }
  const array = unwrap(actual[1])
  return {
    callee: target,
    args:
      !array || (array.type === 'Literal' && array.value === null)
        ? []
        : array.type === 'ArrayExpression'
          ? expandArguments(array.elements as CallArgument[])
          : null,
  }
}
