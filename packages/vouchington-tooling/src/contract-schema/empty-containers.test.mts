import { beforeAll, describe, expect, it } from 'vitest'

import { nodeToOpenApi } from '../openapi-document/contract-schema-to-openapi.mts'
import { extractResponseContracts } from './contract-schema-extractor.mts'
import { validateResponseContract } from './contract-schema-validator.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './virtual-program.mts'

const sources = {
  empty: `interface ApiResponseContracts {
    array: never[]
    readonlyArray: readonly never[]
    record: Record<string, never>
    nested: { items: never[]; details: Record<string, never> }
  }`,
  bounded: `type BoundedArray<T, Min extends number, Max extends number, Unique extends boolean> = T[]
    interface ApiResponseContracts { zero: BoundedArray<never,0,0,false>; capacity: BoundedArray<never,0,5,true> }`,
  'bounded-impossible': `type BoundedArray<T, Min extends number, Max extends number, Unique extends boolean> = T[]
    interface ApiResponseContracts { result: BoundedArray<never,1,5,false> }`,
  never: 'interface ApiResponseContracts { result: never }',
  any: 'interface ApiResponseContracts { result: any }',
  property: 'interface ApiResponseContracts { result: { impossible: never } }',
  'any-array': 'interface ApiResponseContracts { result: any[] }',
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>

describe('closed empty JSON containers', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })

  it.each(['array', 'readonlyArray'] as const)('extracts and validates empty %s', (name) => {
    const contract = extractResponseContracts(matrix.program, matrix.sourceFile('empty'))[name]!
    expect(contract.schema.root).toEqual({ type: 'tuple', items: [], optionalItems: 0 })
    expect(
      nodeToOpenApi(contract.schema.root, {
        definitions: contract.schema.definitions,
        refName: (value) => value,
      }),
    ).toEqual({ type: 'array', prefixItems: [], minItems: 0, items: false, maxItems: 0 })
    expect(validateResponseContract(contract.schema, [])).toEqual([])
    expect(validateResponseContract(contract.schema, ['extra'])).not.toEqual([])
    expect(validateResponseContract(contract.schema, {})).not.toEqual([])
  })

  it('preserves empty bounded never arrays and rejects impossible nonempty bounds', () => {
    const options = { boundedArrayAlias: 'BoundedArray' }
    const contracts = extractResponseContracts(
      matrix.program,
      matrix.sourceFile('bounded'),
      'ApiResponseContracts',
      options,
    )
    for (const contract of Object.values(contracts)) {
      expect(contract.schema.root).toEqual({ type: 'tuple', items: [], optionalItems: 0 })
      expect(validateResponseContract(contract.schema, [])).toEqual([])
      expect(validateResponseContract(contract.schema, [null])).not.toEqual([])
    }
    expect(() =>
      extractResponseContracts(
        matrix.program,
        matrix.sourceFile('bounded-impossible'),
        'ApiResponseContracts',
        options,
      ),
    ).toThrow('impossible never element bounds')
  })

  it('extracts a closed empty record and preserves nested container bounds', () => {
    const contracts = extractResponseContracts(matrix.program, matrix.sourceFile('empty'))
    const record = contracts.record!
    expect(record.schema.definitions['Record<string,never>']).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    })
    expect(
      nodeToOpenApi(record.schema.definitions['Record<string,never>']!, {
        definitions: record.schema.definitions,
        refName: (value) => value,
      }),
    ).toEqual({ type: 'object', properties: {}, additionalProperties: false })
    expect(validateResponseContract(record.schema, {})).toEqual([])
    expect(validateResponseContract(record.schema, { extra: null })).not.toEqual([])
    expect(validateResponseContract(contracts.nested!.schema, { items: [], details: {} })).toEqual(
      [],
    )
    expect(
      validateResponseContract(contracts.nested!.schema, {
        items: [1],
        details: { extra: true },
      }),
    ).not.toEqual([])
  })

  it.each(['never', 'any', 'property', 'any-array'] as const)(
    'still rejects unrepresentable %s',
    (name) => {
      expect(() => extractResponseContracts(matrix.program, matrix.sourceFile(name))).toThrow(
        /never is not supported|any is not allowed/,
      )
    },
  )
})
