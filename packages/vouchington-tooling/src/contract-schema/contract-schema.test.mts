import { beforeAll, describe, expect, it } from 'vitest'

import { extractResponseContracts } from './contract-schema-extractor.mts'
import { validateResponseContract } from './contract-schema-validator.mts'
import type { ExtractContractSchemaOptions } from './types.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './virtual-program.mts'

const COLD_VIRTUAL_PROGRAM_TIMEOUT_MS = 15_000

const ALIAS_OPTIONS: ExtractContractSchemaOptions = {
  formatAliases: { UuidBrand: 'uuid' },
  boundedArrayAlias: 'BoundedArray',
}

const COMPOSITE_SOURCE = `
  type Details = { enabled: boolean } & { label?: string }
  type Recursive = { value: string; child?: Recursive | null }
  interface ApiResponseContracts {
    composite: {
      required: string
      optional?: number
      nullable: string | null
      list: Array<{ id: string }>
      tuple: [string, number?, ...boolean[]]
      choice: 'one' | 'two'
      details: Details
      dictionary: Record<string, { count: number }>
    }
    recursive: Recursive
  }
`
const sources = {
  composite: COMPOSITE_SOURCE,
  'hash-first': `
    type Payload = { alpha: string; beta: number }
    interface ApiResponseContracts { result: Payload & { state: 'on' | 'off' } }
  `,
  'hash-reordered': `
    type Payload = { beta: number; alpha: string }
    interface ApiResponseContracts { result: { state: 'off' | 'on' } & Payload }
  `,
  unknown: `interface ApiResponseContracts { result: { metadata: unknown } }`,
  any: `interface ApiResponseContracts { result: any }`,
  callable: `interface ApiResponseContracts { result: () => string }`,
  'class-instance': `
    class Result { value = 'value' }
    interface ApiResponseContracts { result: Result }
  `,
  date: `interface ApiResponseContracts { result: { created_at: Date } }`,
  promise: `
    interface ApiResponseContracts { result: { rows: Promise<Array<{ id: string }>> } }
  `,
  'to-json': `
    class Bytes { toJSON(): { type: 'Buffer'; data: number[] } { return { type: 'Buffer', data: [] } } }
    interface ApiResponseContracts { result: { bytes: Bytes } }
  `,
  paths: `
    interface ApiResponseContracts {
      result: {
        rows: Array<{ id: string; required: boolean }>
        byId: Record<string, { count: number }>
      }
    }
  `,
  optional: `
    interface ApiResponseContracts { result: { id: string; optional?: { enabled: boolean } } }
  `,
  'constrained-array': `
    type BoundedArray<T, TMin extends number, TMax extends number, TUnique extends boolean> = T[]
    type UuidBrand = string & { readonly __uuidBrand: never }
    interface ApiResponseContracts {
      result: { ids: BoundedArray<UuidBrand, 1, 100, true> }
    }
  `,
  'plain-uuid-alias': `
    type UuidBrand = string & { readonly __uuidBrand: never }
    interface ApiResponseContracts { result: { id: UuidBrand } }
  `,
  never: `interface ApiResponseContracts { result: never }`,
  constructable: `interface ApiResponseContracts { result: new () => { value: string } }`,
  'missing-registry': `export type OnlyAlias = string`,
  'invalid-bounds': `
    type BoundedArray<T, TMin extends number, TMax extends number, TUnique extends boolean> = T[]
    interface ApiResponseContracts { result: BoundedArray<string, 5, 1, true> }
  `,
  'non-literal-bounds': `
    type Bound = number
    type BoundedArray<T, TMin extends number, TMax extends number, TUnique extends boolean> = T[]
    interface ApiResponseContracts { result: BoundedArray<string, Bound, 3, true> }
  `,
  'generic-literal': `
    type Box<T> = { value: T }
    interface ApiResponseContracts {
      topic: Box<'topic'>
      notice: Box<'notification'>
      flag: Box<true>
      count: Box<1>
      empty: Box<null>
      nested: Box<Array<{ z: string }>>
      amount: Box<number>
      yes: Box<boolean>
    }
  `,
  'named-interface': `
    interface Named { x: string }
    interface ApiResponseContracts { result: Named }
  `,
  'rest-binding': `
    function mapRows(rows: Array<{ a: string; b: number; c: boolean }>) {
      return rows.map(({ a, ...row }) => row)
    }
    interface ApiResponseContracts { result: ReturnType<typeof mapRows> }
  `,
  'non-literal-unique': `
    type Unique = boolean
    type BoundedArray<T, TMin extends number, TMax extends number, TUnique extends boolean> = T[]
    interface ApiResponseContracts { result: BoundedArray<string, 1, 2, Unique> }
  `,
  'missing-array-args': `
    type BoundedArray<T> = T[]
    interface ApiResponseContracts { result: BoundedArray<string> }
  `,
  'property-error': `
    interface ApiResponseContracts { result: { bad: () => string } }
  `,
  'plain-string': `interface ApiResponseContracts { result: string }`,
  'optional-boolean': `interface ApiResponseContracts { result: { flag?: boolean } }`,
  'simple-tuple': `interface ApiResponseContracts { result: [string, number] }`,
  'promise-like': `
    interface ApiResponseContracts { result: { rows: PromiseLike<string> } }
  `,
  'two-named': `
    type Alpha = { a: string }
    type Beta = { b: number }
    interface ApiResponseContracts { result: { alpha: Alpha; beta: Beta } }
  `,
  'bare-array-alias': `
    type BoundedArray = string[]
    interface ApiResponseContracts { result: BoundedArray }
  `,
  'named-union': `
    type Status = 'on' | 'off'
    interface ApiResponseContracts { result: Status }
  `,
  'typeof-object': `
    const sample = { x: 'a' }
    interface ApiResponseContracts { result: typeof sample }
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

function contracts(
  sourceId: keyof typeof sources,
  options: ExtractContractSchemaOptions = ALIAS_OPTIONS,
) {
  return extractResponseContracts(matrix.program, matrix.sourceFile(sourceId), undefined, options)
}

describe('response contract schemas', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('extracts required, optional, nullable, array, tuple, union, intersection, and dictionary shapes', () => {
    const contract = contracts('composite').composite!
    const root = contract.schema.root
    expect(root).toMatchObject({ type: 'object' })
    if (root.type !== 'object') throw new Error('Expected an object schema')

    expect(root.properties.required).toMatchObject({ required: true, schema: { type: 'string' } })
    expect(root.properties.optional).toMatchObject({ required: false, schema: { type: 'number' } })
    expect(root.properties.nullable?.schema).toMatchObject({ type: 'union' })
    expect(root.properties.list?.schema).toMatchObject({ type: 'array' })
    expect(root.properties.tuple?.schema).toMatchObject({
      type: 'tuple',
      optionalItems: 1,
      rest: { type: 'boolean' },
    })
    expect(root.properties.choice?.schema).toMatchObject({ type: 'union' })
    expect(root.properties.details?.schema).toMatchObject({ type: 'intersection' })
    const dictionary = root.properties.dictionary?.schema
    expect(dictionary).toMatchObject({ type: 'ref' })
    if (dictionary?.type !== 'ref') throw new Error('Expected a dictionary reference')
    expect(contract.schema.definitions[dictionary.name]).toMatchObject({
      type: 'object',
      properties: {},
      additionalProperties: { type: 'object' },
    })
  })

  it('extracts array bounds and uniqueness from an injected bounded array alias', () => {
    const contract = contracts('constrained-array').result!
    const root = contract.schema.root
    expect(root).toMatchObject({ type: 'object' })
    if (root.type !== 'object') throw new Error('Expected an object schema')

    expect(root.properties.ids?.schema).toEqual({
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
    })
  })

  it('does not apply format aliases unless options inject them', () => {
    expect(() => contracts('plain-uuid-alias', {})).toThrow('never is not supported')

    const withAlias = contracts('plain-uuid-alias').result!
    const withRoot = withAlias.schema.root
    expect(withRoot).toMatchObject({ type: 'object' })
    if (withRoot.type !== 'object') throw new Error('Expected an object schema')
    expect(withRoot.properties.id?.schema).toEqual({ type: 'string', format: 'uuid' })
  })

  it('does not apply a bounded array alias unless options inject it', () => {
    const contract = contracts('constrained-array', {
      formatAliases: { UuidBrand: 'uuid' },
    }).result!
    const root = contract.schema.root
    expect(root).toMatchObject({ type: 'object' })
    if (root.type !== 'object') throw new Error('Expected an object schema')
    expect(root.properties.ids?.schema).toEqual({
      type: 'array',
      items: { type: 'string', format: 'uuid' },
    })
  })

  it('extracts recursive types through stable definitions and references', () => {
    const schema = contracts('composite').recursive!.schema
    expect(schema.root).toEqual({ type: 'ref', name: 'Recursive' })
    expect(schema.definitions.Recursive).toMatchObject({
      type: 'object',
      properties: {
        child: {
          required: false,
          schema: {
            type: 'union',
            variants: expect.arrayContaining([
              { type: 'null' },
              { type: 'ref', name: 'Recursive' },
            ]),
          },
        },
      },
    })
  })

  it('keeps hashes stable when declarations are reordered', () => {
    const first = contracts('hash-first').result!
    const reordered = contracts('hash-reordered').result!

    expect(reordered.hash).toBe(first.hash)
  })

  it('treats explicit unknown as an open subtree', () => {
    const contract = contracts('unknown').result!
    expect(
      validateResponseContract(contract.schema, { metadata: { anything: [1, null] } }),
    ).toEqual([])
  })

  it.each([
    {
      name: 'any',
      sourceId: 'any' as const,
      expectedError: 'any is not allowed',
    },
    {
      name: 'callable',
      sourceId: 'callable' as const,
      expectedError: 'callable types are not supported',
    },
    {
      name: 'class-instance',
      sourceId: 'class-instance' as const,
      expectedError: 'class instances are not supported',
    },
    {
      name: 'never',
      sourceId: 'never' as const,
      expectedError: 'never is not supported',
    },
    {
      name: 'constructable',
      sourceId: 'constructable' as const,
      expectedError: 'constructable types are not supported',
    },
    {
      name: 'invalid-bounds',
      sourceId: 'invalid-bounds' as const,
      expectedError: 'invalid item bounds',
    },
    {
      name: 'non-literal-bounds',
      sourceId: 'non-literal-bounds' as const,
      expectedError: 'bounds must be numeric literals',
    },
    {
      name: 'non-literal-unique',
      sourceId: 'non-literal-unique' as const,
      expectedError: 'uniqueness must be literal',
    },
    {
      name: 'missing-array-args',
      sourceId: 'missing-array-args' as const,
      expectedError: 'requires four type arguments',
    },
    {
      name: 'property-error',
      sourceId: 'property-error' as const,
      expectedError: 'Property "bad"',
    },
    {
      name: 'bare-array-alias',
      sourceId: 'bare-array-alias' as const,
      expectedError: 'requires four type arguments',
    },
  ])('rejects $name response types', ({ sourceId, expectedError }) => {
    expect(() => contracts(sourceId)).toThrow(expectedError)
  })

  it('requires the registry interface and keeps generic literal identities distinct', () => {
    expect(() => contracts('missing-registry')).toThrow('was not found')
    const extracted = contracts('generic-literal')
    expect(extracted.topic!.schema.root).toEqual({ type: 'ref', name: 'Box<topic>' })
    expect(extracted.notice!.schema.root).toEqual({ type: 'ref', name: 'Box<notification>' })
    expect(extracted.flag!.schema.root).toEqual({ type: 'ref', name: 'Box<true>' })
    expect(extracted.count!.schema.root).toEqual({ type: 'ref', name: 'Box<1>' })
    expect(extracted.empty!.schema.root).toEqual({ type: 'ref', name: 'Box<null>' })
    expect(extracted.amount!.schema.root).toEqual({ type: 'ref', name: 'Box<number>' })
    expect(extracted.yes!.schema.root).toEqual({ type: 'ref', name: 'Box<boolean>' })
    expect(extracted.nested!.schema.root).toMatchObject({ type: 'ref' })
    expect(contracts('named-interface').result!.schema.root).toEqual({
      type: 'ref',
      name: 'Named',
    })
    const rest = contracts('rest-binding').result!.schema.root
    expect(rest).toMatchObject({ type: 'array' })
    if (rest.type !== 'array') throw new Error('Expected an array schema')
    expect(rest.items).toMatchObject({ type: 'object' })
    expect(rest.items).not.toEqual({ type: 'ref', name: 'row' })
  })

  it('models Date as its JSON string representation', () => {
    const contract = contracts('date').result!

    expect(
      validateResponseContract(contract.schema, { created_at: '2026-07-13T00:00:00.000Z' }),
    ).toEqual([])
  })

  it('unwraps promised fields used by streamed JSON responses', () => {
    const contract = contracts('promise').result!

    expect(contract.schema.root).toMatchObject({ type: 'object' })
    expect(validateResponseContract(contract.schema, { rows: [{ id: 'one' }] })).toEqual([])
  })

  it('uses explicit toJSON return types for serialized objects', () => {
    const contract = contracts('to-json').result!

    expect(
      validateResponseContract(contract.schema, { bytes: { type: 'Buffer', data: [1] } }),
    ).toEqual([])
  })

  it('reports missing required and unexpected fixture fields with normalized paths', () => {
    const contract = contracts('paths').result!
    const issues = validateResponseContract(contract.schema, {
      rows: [{ id: 'one', extra: true }],
      byId: { dynamicKey: { extra: 1 } },
      topLevelExtra: true,
    })

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '$.rows[*].required', kind: 'missing-required' }),
        expect.objectContaining({ path: '$.rows[*].extra', kind: 'unexpected' }),
        expect.objectContaining({ path: '$.byId{*}.count', kind: 'missing-required' }),
        expect.objectContaining({ path: '$.byId{*}.extra', kind: 'unexpected' }),
        expect.objectContaining({ path: '$.topLevelExtra', kind: 'unexpected' }),
      ]),
    )
  })

  it('validates optional fields only when a fixture scenario includes them', () => {
    const contract = contracts('optional').result!

    expect(validateResponseContract(contract.schema, { id: 'one' })).toEqual([])
    expect(validateResponseContract(contract.schema, { id: 'one', optional: {} })).toEqual([
      expect.objectContaining({ path: '$.optional.enabled', kind: 'missing-required' }),
    ])
  })

  it('covers plain strings, optional booleans, fixed tuples, and PromiseLike', () => {
    expect(contracts('plain-string').result!.schema.root).toEqual({ type: 'string' })
    const optionalBoolean = contracts('optional-boolean').result!.schema.root
    expect(optionalBoolean).toMatchObject({ type: 'object' })
    const tuple = contracts('simple-tuple').result!.schema.root
    expect(tuple).toMatchObject({ type: 'tuple', optionalItems: 0 })
    expect(tuple).not.toHaveProperty('rest')
    expect(contracts('promise-like').result!.schema.root).toMatchObject({ type: 'object' })
    const twoNamed = contracts('two-named').result!.schema
    expect(Object.keys(twoNamed.definitions).toSorted()).toEqual(['Alpha', 'Beta'])
    expect(contracts('named-union').result!.schema.root).toEqual({ type: 'ref', name: 'Status' })
    expect(contracts('typeof-object').result!.schema.root).toMatchObject({ type: 'object' })
  })
})
