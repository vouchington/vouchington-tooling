import ts from '../contract-schema/typescript-api.mts'

import { isContextMethod } from './response-contract-route-analysis.mts'

export function isXmlResponseCall(call: ts.CallExpression): boolean {
  const expression = call.expression
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'xml' &&
    isContextMethod(expression.expression, 'response')
  )
}

export function streamingTextMediaType(
  call: ts.CallExpression,
): 'application/xml' | 'text/csv' | undefined {
  let statement: ts.Node = call
  while (!ts.isStatement(statement)) statement = statement.parent
  const contentType = precedingContentType(statement as ts.Statement)
  return contentType === 'unsupported' ? undefined : contentType
}

type StreamingTextMediaType = 'application/xml' | 'text/csv' | 'unsupported'

function precedingContentType(statement: ts.Statement): StreamingTextMediaType | undefined {
  const block = statement.parent
  if (!ts.isBlock(block)) return undefined
  const index = block.statements.indexOf(statement)
  for (let i = index - 1; i >= 0; i--) {
    const contentType = contentTypeStatement(block.statements[i]!)
    if (contentType) return contentType
  }
  const enclosing = block.parent
  return ts.isStatement(enclosing) ? precedingContentType(enclosing) : undefined
}

function contentTypeStatement(statement: ts.Statement): StreamingTextMediaType | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression))
    return undefined
  const setter = statement.expression
  if (!isContextMethod(setter.expression, 'set')) return undefined
  const [name, value] = setter.arguments
  if (!name || !ts.isStringLiteral(name) || name.text.toLowerCase() !== 'content-type')
    return undefined
  if (!value || !ts.isStringLiteral(value)) return 'unsupported'
  const contentType = value.text.toLowerCase()
  if (contentType.startsWith('text/csv')) return 'text/csv'
  if (contentType.startsWith('application/xml')) return 'application/xml'
  return 'unsupported'
}
