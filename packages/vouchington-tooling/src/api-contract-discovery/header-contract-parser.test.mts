import { describe, expect, it } from 'vitest'

import ts from '../contract-schema/typescript-api.mts'
import { parseHeaderContract } from './header-contract-parser.mts'

function parse(source: string) {
  const file = ts.createSourceFile('headers.ts', `(${source})`, ts.ScriptTarget.Latest, true)
  const statement = file.statements[0]
  if (!statement || !ts.isExpressionStatement(statement)) throw new Error('Expected expression')
  const expression = statement.expression
  if (
    !ts.isParenthesizedExpression(expression) ||
    !ts.isObjectLiteralExpression(expression.expression)
  )
    throw new Error('Expected object literal')
  return parseHeaderContract(file, expression.expression)
}

describe('header contract parser', () => {
  it('preserves a prototype-shaped header key as an own entry', () => {
    const result = parse(`{ request: { '__proto__': { type: 'string', required: true } } }`)
    expect(Object.hasOwn(result.requestHeaders, '__proto__')).toBe(true)
    expect(result.requestHeaders['__proto__']).toEqual({ type: 'string', required: true })
  })

  it('parses response descriptions, errors, and headers', () => {
    const result = parse(`{ responses: { 400: {
      description: 'Rejected', errors: [{ code: 'bad', message: 'Bad input' }],
      headers: { 'x-reason': { type: 'string', format: 'uuid', description: 'Reason' } }
    } } }`)
    expect(result.responseHeaders[400]).toEqual({
      description: 'Rejected',
      errors: [{ code: 'bad', message: 'Bad input' }],
      headers: {
        'x-reason': { type: 'string', required: false, format: 'uuid', description: 'Reason' },
      },
    })
  })

  it('reads an explicit false requirement and ignores a non-boolean requirement', () => {
    const result = parse(`{ request: {
      'x-optional': { type: 'string', required: false },
      'x-invalid': { type: 'string', required: 1 }
    } }`)
    expect(result.requestHeaders['x-optional']?.required).toBe(false)
    expect(result.requestHeaders['x-invalid']?.required).toBe(false)
  })

  it('defaults an empty response declaration to no headers or errors', () => {
    expect(parse(`{ responses: { 204: {} } }`).responseHeaders[204]).toEqual({ headers: {} })
  })

  it.each([
    [`{ request: [] }`, /request must be an object/],
    [`{ responses: { bad: {} } }`, /response status must be a numeric/],
    [`{ responses: { 400: { errors: {} } } }`, /errors must be an array/],
    [`{ responses: { 400: { errors: [42] } } }`, /errors entries must be objects/],
    [`{ responses: { 400: { errors: [{}] } } }`, /requires string code/],
    [`{ request: { bad: {} } }`, /header must be a string-keyed/],
    [`{ request: { 'x-a': {} } }`, /requires string type/],
  ])('rejects malformed header declarations: %s', (source, message) => {
    expect(() => parse(source)).toThrow(message)
  })
})
