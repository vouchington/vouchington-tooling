import { findVariable, unwrap, type NodeLike, type RuleContextLike } from './ast-helpers.mts'
import { inlineInvocation, type CallArgument } from './serial-cursor-call-arguments.mts'
import { runtimeChildren } from './serial-cursor-runtime-children.mts'

function bodyMatches(node: NodeLike, matches: (node: NodeLike) => boolean): boolean {
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type))
    return false
  if (matches(node)) return true
  if (
    [
      'ClassDeclaration',
      'ClassExpression',
      'ClassBody',
      'PropertyDefinition',
      'MethodDefinition',
    ].includes(node.type)
  )
    return runtimeChildren(node).some((child) => bodyMatches(child, matches))
  return Object.entries(node).some(([key, value]) => {
    if (key === 'parent') return false
    const children: unknown[] = Array.isArray(value) ? value : [value]
    return children.some(
      (child) =>
        child !== null &&
        typeof child === 'object' &&
        'type' in child &&
        typeof child.type === 'string' &&
        bodyMatches(child as NodeLike, matches),
    )
  })
}

export function invokedBodyMatches(
  callee: NodeLike | null | undefined,
  args: readonly CallArgument[],
  matches: (node: NodeLike) => boolean,
  context: RuleContextLike,
  consumeIterable: boolean,
): boolean {
  const invocation = inlineInvocation(callee, args)
  callee = invocation.callee
  if (!callee || !['ArrowFunctionExpression', 'FunctionExpression'].includes(callee.type))
    return false
  const parameters = callee.params as NodeLike[]
  return (
    (invocation.args !== null &&
      parameters.some(
        (parameter, index) =>
          undefinedArgument(invocation.args?.[index], context) && bodyMatches(parameter, matches),
      )) ||
    ((!callee.generator || (consumeIterable && !callee.async)) &&
      bodyMatches(callee.body as NodeLike, matches))
  )
}

function undefinedArgument(argument: CallArgument, context: RuleContextLike): boolean {
  const value = unwrap(argument)
  if (!value || (value.type === 'UnaryExpression' && value.operator === 'void')) return true
  return (
    value.type === 'Identifier' &&
    value.name === 'undefined' &&
    !findVariable(context, value, true)?.defs.length
  )
}
