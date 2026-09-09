import { describe, expect, it } from 'vitest'

import type { ContractSchema } from '../openapi-document/contract-schema-types.mts'
import { validateResponseContract } from './contract-schema-validator.mts'

describe('validateResponseContract', () => {
  it('accepts primitives, literals, null, unknown, and refs', () => {
    const schema: ContractSchema = {
      root: {
        type: 'object',
        properties: {
          flag: { required: true, schema: { type: 'boolean' } },
          count: { required: true, schema: { type: 'number' } },
          label: { required: true, schema: { type: 'literal', value: 'ok' } },
          empty: { required: true, schema: { type: 'null' } },
          any: { required: true, schema: { type: 'unknown' } },
          nested: { required: true, schema: { type: 'ref', name: 'Nested' } },
        },
        additionalProperties: false,
      },
      definitions: {
        Nested: {
          type: 'object',
          properties: { id: { required: true, schema: { type: 'string' } } },
          additionalProperties: false,
        },
      },
    }

    expect(
      validateResponseContract(schema, {
        flag: true,
        count: 1,
        label: 'ok',
        empty: null,
        any: { free: true },
        nested: { id: 'one' },
      }),
    ).toEqual([])
    expect(validateResponseContract(schema, { flag: 'no' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '$.flag',
          kind: 'type',
          message: expect.stringContaining('boolean'),
        }),
      ]),
    )
  })

  it('validates tuples, unions, and intersections', () => {
    const schema: ContractSchema = {
      root: {
        type: 'object',
        properties: {
          tuple: {
            required: true,
            schema: {
              type: 'tuple',
              items: [{ type: 'string' }, { type: 'number' }],
              optionalItems: 1,
              rest: { type: 'boolean' },
            },
          },
          choice: {
            required: true,
            schema: {
              type: 'union',
              variants: [
                { type: 'literal', value: 'a' },
                { type: 'literal', value: 'b' },
              ],
            },
          },
          details: {
            required: true,
            schema: {
              type: 'intersection',
              variants: [
                {
                  type: 'object',
                  properties: { enabled: { required: true, schema: { type: 'boolean' } } },
                  additionalProperties: false,
                },
                {
                  type: 'object',
                  properties: { label: { required: false, schema: { type: 'string' } } },
                  additionalProperties: { type: 'number' },
                },
              ],
            },
          },
        },
        additionalProperties: false,
      },
      definitions: {},
    }

    expect(
      validateResponseContract(schema, {
        tuple: ['one', 2, true],
        choice: 'a',
        details: { enabled: true, label: 'x', extra: 1 },
      }),
    ).toEqual([])
    expect(
      validateResponseContract(schema, {
        tuple: [1],
        choice: 'c',
        details: { enabled: true, surprise: 'no' },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '$.tuple[0]', kind: 'type' }),
        expect.objectContaining({ path: '$.choice', kind: 'type' }),
        expect.objectContaining({ path: '$.details{*}', kind: 'type' }),
      ]),
    )
  })

  it('rejects short, overlong, and non-array tuples plus unknown refs', () => {
    const schema: ContractSchema = {
      root: {
        type: 'tuple',
        items: [{ type: 'string' }, { type: 'number' }],
        optionalItems: 0,
      },
      definitions: {},
    }
    expect(validateResponseContract(schema, ['a'])).toEqual([
      expect.objectContaining({
        path: '$',
        kind: 'type',
        message: expect.stringContaining('at least'),
      }),
    ])
    expect(validateResponseContract(schema, ['a', 1, true])).toEqual([
      expect.objectContaining({
        path: '$',
        kind: 'type',
        message: expect.stringContaining('at most'),
      }),
    ])
    expect(validateResponseContract(schema, 'nope')).toEqual([
      expect.objectContaining({
        path: '$',
        kind: 'type',
        message: expect.stringContaining('tuple'),
      }),
    ])
    expect(() =>
      validateResponseContract({ root: { type: 'ref', name: 'Missing' }, definitions: {} }, {}),
    ).toThrow('Unknown response contract schema reference')
  })

  it('follows refs while collecting intersection shapes', () => {
    const schema: ContractSchema = {
      root: {
        type: 'intersection',
        variants: [
          {
            type: 'intersection',
            variants: [
              { type: 'ref', name: 'Left' },
              { type: 'ref', name: 'Right' },
            ],
          },
        ],
      },
      definitions: {
        Left: {
          type: 'object',
          properties: { id: { required: true, schema: { type: 'string' } } },
          additionalProperties: false,
        },
        Right: {
          type: 'object',
          properties: { name: { required: true, schema: { type: 'string' } } },
          additionalProperties: false,
        },
      },
    }
    expect(validateResponseContract(schema, { id: '1', name: 'n' })).toEqual([])
    expect(validateResponseContract(schema, { id: '1', name: 'n', extra: 1 })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '$.extra', kind: 'unexpected' })]),
    )
  })

  it('reports unexpected fields for intersections without additional properties', () => {
    const schema: ContractSchema = {
      root: {
        type: 'intersection',
        variants: [
          {
            type: 'object',
            properties: { id: { required: true, schema: { type: 'string' } } },
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: { name: { required: true, schema: { type: 'string' } } },
            additionalProperties: false,
          },
        ],
      },
      definitions: {},
    }
    expect(validateResponseContract(schema, { id: '1', name: 'n', extra: true })).toEqual([
      expect.objectContaining({ path: '$.extra', kind: 'unexpected' }),
    ])
    expect(validateResponseContract(schema, 'nope')).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '$', kind: 'type' })]),
    )
  })
})
