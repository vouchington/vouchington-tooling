import { beforeAll, describe, expect, it } from 'vitest'
import { nodeToOpenApi } from '../openapi-document/contract-schema-to-openapi.mts'
import { extractResponseContracts } from './contract-schema-extractor.mts'
import { validateResponseContract } from './contract-schema-validator.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './virtual-program.mts'

const sources = {
  direct: `interface ApiResponseContracts { result: { __proto__: string; constructor: number; toString?: boolean } }`,
  intersection: `type Fields = { __proto__: string; constructor: number; toString?: boolean }
    interface ApiResponseContracts { result: Fields & { extra: string } }`,
  narrowed: `type Fields = { __proto__?: string | null; constructor?: number | null }
    interface ApiResponseContracts { result: Fields & { __proto__: string; constructor: number } }`,
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>

describe('declared prototype-named JSON fields', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(['direct', 'intersection', 'narrowed'] as const)(
    'preserves declared fields in %s',
    (name) => {
      const contract = extractResponseContracts(matrix.program, matrix.sourceFile(name)).result!
      const value: unknown = JSON.parse(
        name === 'intersection'
          ? '{"__proto__":"value","constructor":1,"extra":"present"}'
          : '{"__proto__":"value","constructor":1}',
      )
      expect(validateResponseContract(contract.schema, value)).toEqual([])
      expect(
        validateResponseContract(
          contract.schema,
          JSON.parse('{"constructor":1,"extra":"present"}'),
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: '$.__proto__', kind: 'missing-required' }),
        ]),
      )
      expect(
        validateResponseContract(
          contract.schema,
          JSON.parse('{"__proto__":1,"constructor":1,"extra":"present"}'),
        ),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: '$.__proto__', kind: 'type' })]),
      )
      if (name !== 'narrowed') {
        const optionalBody =
          name === 'intersection'
            ? '{"__proto__":"value","constructor":1,"extra":"present","toString":true}'
            : '{"__proto__":"value","constructor":1,"toString":true}'
        expect(validateResponseContract(contract.schema, JSON.parse(optionalBody))).toEqual([])
        expect(
          validateResponseContract(contract.schema, JSON.parse(optionalBody.replace('true', '1'))),
        ).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: '$.toString', kind: 'type' })]),
        )
      }
      const rendered = nodeToOpenApi(contract.schema.root, {
        definitions: contract.schema.definitions,
        refName: (value) => value,
      })
      const serialized: unknown = JSON.parse(JSON.stringify(rendered))
      expect(serialized).toMatchObject({
        type: 'object',
        properties: JSON.parse('{"__proto__":{"type":"string"},"constructor":{"type":"number"}}'),
        required: expect.arrayContaining(['__proto__', 'constructor']),
      })
      expect(Object.getPrototypeOf(Object.prototype)).toBe(null)
    },
  )
})
