import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { extractQueryParameterDescriptor } from './query-contract-extraction.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const descriptors = {
  string: `{ kind: 'string' }`,
  uuid: `{ kind: 'string'; format: 'uuid'; description: 'Identifier' }`,
  uri: `{ kind: 'string'; format: 'uri' }`,
  boolean: `{ kind: 'boolean' }`,
  nullable: `{ kind: 'nullable-boolean' }`,
  mixed: `{ kind: 'uuid-or-uri' }`,
  number: `{ kind: 'number' }`,
  integer: `{ kind: 'integer'; minimum: 0; maximum: 10 }`,
  integerDefault: `{ kind: 'integer'; minimum: 0; maximum: 10; default: 2 }`,
  enum: `{ kind: 'enum'; values: readonly ['a', 'b'] }`,
  enumDefault: `{ kind: 'enum'; values: readonly ['a', 'b']; default: 'a' }`,
  csvString: `{ kind: 'csv-array'; style: 'form'; explode: false; items: { kind: 'string' } }`,
  csvEnum: `{ kind: 'csv-array'; style: 'form'; explode: false; items: { kind: 'enum'; values: ['a'] } }`,
  noKind: `{}`,
  optionalKind: `{ kind?: 'string' }`,
  wideKind: `{ kind: string }`,
  badFormat: `{ kind: 'string'; format: 'custom' }`,
  wideDescription: `{ kind: 'string'; description: string }`,
  optionalDescription: `{ kind: 'string'; description?: 'x' }`,
  wideMinimum: `{ kind: 'integer'; minimum: number; maximum: 10 }`,
  optionalDefault: `{ kind: 'integer'; minimum: 0; maximum: 10; default?: 2 }`,
  wideDefault: `{ kind: 'integer'; minimum: 0; maximum: 10; default: number }`,
  badEnumDefault: `{ kind: 'enum'; values: ['a']; default: 'b' }`,
  arrayValues: `{ kind: 'enum'; values: string[] }`,
  emptyValues: `{ kind: 'enum'; values: [] }`,
  numericValues: `{ kind: 'enum'; values: ['a', 2] }`,
  badStyle: `{ kind: 'csv-array'; style: 'other'; explode: false; items: { kind: 'string' } }`,
  explodeTrue: `{ kind: 'csv-array'; style: 'form'; explode: true; items: { kind: 'string' } }`,
  explodeWide: `{ kind: 'csv-array'; style: 'form'; explode: boolean; items: { kind: 'string' } }`,
  badItems: `{ kind: 'csv-array'; style: 'form'; explode: false; items: { kind: 'integer'; minimum: 0; maximum: 2 } }`,
  unknown: `{ kind: 'mystery' }`,
  mappedKind: `{ [Key in 'kind']: 'string' }`,
  mappedDescription: `{ kind: 'string' } & { [Key in 'description']: 'Mapped description' }`,
  mappedDefault: `{ kind: 'integer'; minimum: 0; maximum: 10 } & { [Key in 'default']: 2 }`,
  requiredIntersection: `{ kind: 'string' } & { readonly required: true }`,
  requiredEnum: `{ kind: 'enum'; values: readonly ['a', 'b']; required: true }`,
  requiredFalse: `{ kind: 'string'; required: false }`,
  requiredBoolean: `{ kind: 'string'; required: boolean }`,
  requiredOptional: `{ kind: 'string'; required?: true }`,
  requiredDefault: `{ kind: 'integer'; minimum: 0; maximum: 10; default: 2; required: true }`,
  requiredItems: `{ kind: 'csv-array'; style: 'form'; explode: false; items: { kind: 'string'; required: true } }`,
  requiredCsv: `{ kind: 'csv-array'; style: 'form'; explode: false; required: true; items: { kind: 'string' } }`,
  unionDescription: `{ kind: 'string'; description: 'x'; a: 1 } | { kind: 'string'; description: 'x'; b: 1 }`,
  unionDefault: `{ kind: 'integer'; minimum: 0; maximum: 10; default: 2; a: 1 } | { kind: 'integer'; minimum: 0; maximum: 10; default: 2; b: 1 }`,
} as const
let matrix: VirtualProgramMatrix<string>

function extract(name: keyof typeof descriptors) {
  const source = matrix.sourceFile(name.toLowerCase())
  const statement = source.statements.find(ts.isVariableStatement)!
  const declaration = statement.declarationList.declarations[0]!
  const checker = matrix.program.getTypeChecker()
  return extractQueryParameterDescriptor(
    checker.getTypeAtLocation(declaration.name),
    checker,
    source,
    declaration,
    'value',
  )
}

describe('query descriptor compiler boundaries', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(
      import.meta,
      Object.fromEntries(
        Object.entries(descriptors).map(([name, type]) => [
          name.toLowerCase(),
          `declare const descriptor: ${type}`,
        ]),
      ),
    )
  })

  it.each([
    ['string', { kind: 'string' }],
    ['uuid', { kind: 'string', format: 'uuid', description: 'Identifier' }],
    ['uri', { kind: 'string', format: 'uri' }],
    ['boolean', { kind: 'boolean' }],
    ['nullable', { kind: 'nullable-boolean' }],
    ['mixed', { kind: 'uuid-or-uri' }],
    ['number', { kind: 'number' }],
    ['integer', { kind: 'integer', minimum: 0, maximum: 10 }],
    ['integerDefault', { kind: 'integer', minimum: 0, maximum: 10, default: 2 }],
    ['enum', { kind: 'enum', values: ['a', 'b'] }],
    ['enumDefault', { kind: 'enum', values: ['a', 'b'], default: 'a' }],
    ['csvString', { kind: 'csv-array', style: 'form', explode: false, items: { kind: 'string' } }],
    [
      'csvEnum',
      { kind: 'csv-array', style: 'form', explode: false, items: { kind: 'enum', values: ['a'] } },
    ],
    ['mappedDescription', { kind: 'string', description: 'Mapped description' }],
    ['mappedDefault', { kind: 'integer', minimum: 0, maximum: 10, default: 2 }],
    ['requiredIntersection', { kind: 'string', required: true }],
    ['requiredEnum', { kind: 'enum', values: ['a', 'b'], required: true }],
    [
      'requiredCsv',
      {
        kind: 'csv-array',
        style: 'form',
        explode: false,
        required: true,
        items: { kind: 'string' },
      },
    ],
    ['unionDescription', { kind: 'string', description: 'x' }],
    ['unionDefault', { kind: 'integer', minimum: 0, maximum: 10, default: 2 }],
  ] as const)('extracts %s', (name, expected) => {
    expect(extract(name)).toEqual(expected)
  })

  it.each([
    ['noKind', 'requires literal kind'],
    ['optionalKind', 'requires literal kind'],
    ['wideKind', 'requires literal kind'],
    ['badFormat', 'unsupported format'],
    ['wideDescription', 'requires literal description'],
    ['optionalDescription', 'description must be literal when present'],
    ['wideMinimum', 'requires literal minimum'],
    ['optionalDefault', 'default must be literal when present'],
    ['wideDefault', 'requires literal default'],
    ['badEnumDefault', 'default must be one of values'],
    ['arrayValues', 'values must be a literal tuple'],
    ['emptyValues', 'values must contain string literals'],
    ['numericValues', 'values must contain string literals'],
    ['badStyle', 'style must be form'],
    ['explodeTrue', 'explode must be false'],
    ['explodeWide', 'requires literal explode'],
    ['badItems', 'array items must be string or enum'],
    ['unknown', 'unsupported kind'],
    ['mappedKind', 'requires declared kind'],
    ['requiredFalse', 'required must be the literal true'],
    ['requiredBoolean', 'required must be the literal true'],
    ['requiredOptional', 'required must be literal when present'],
    ['requiredDefault', 'required cannot be combined with default'],
    ['requiredItems', 'array items cannot be required'],
  ] as const)('rejects %s', (name, reason) => {
    expect(() => extract(name)).toThrow(reason)
  })
})
