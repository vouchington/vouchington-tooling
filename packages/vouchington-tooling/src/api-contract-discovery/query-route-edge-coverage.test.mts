import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'

import { extractQueryParameterDescriptor } from './query-contract-extraction.mts'
import { discoverRegisteredRoutes } from './registered-route-catalog.mts'
import {
  buildVirtualProgramMatrix,
  COLD_VIRTUAL_PROGRAM_TIMEOUT_MS,
  type VirtualProgramMatrix,
} from './test-setup.test-helpers.mts'

const sources = {
  query: `
    const badEnum = { kind: 'enum', values: ['a', 'b'], default: 'c' } as const
    const badExplode = { kind: 'csv-array', style: 'form', explode: true, items: { kind: 'string' } } as const
    const badItems = { kind: 'csv-array', style: 'form', explode: false, items: { kind: 'number' } } as const
    const badBoolean = { kind: 'csv-array', style: 'form', explode: true as boolean, items: { kind: 'string' } } as const
    const badTuple = { kind: 'enum', values: [1, 2] as const } as const
  `,
  'conflicting-status': `
    declare const app: any
    declare function apiOpenApiNoContent(key: string, status: number): void
    app.route('/x').get(() => {
      apiOpenApiNoContent('GET:/x', 202)
      apiOpenApiNoContent('GET:/x', 204)
    })
  `,
  'sse-set-type': `
    declare const app: any
    app.route('/x').get((ctx: any) => { ctx.response.setType('TEXT/EVENT-STREAM') })
  `,
  'error-405': `
    declare const app: any
    app.route('/x').get((ctx: any) => { ctx.throw(405) })
  `,
  'declared-handler': `
    declare const app: any
    declare function handle(): void
    app.route('/x').get(handle)
  `,
  'parameter-handler': `
    declare const app: any
    function register(handle: () => void) { app.route('/x').get(handle) }
  `,
  'chained-route': `
    declare const app: any
    app.route('/x').use(() => {}).get(() => {})
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

function descriptor(name: string) {
  const sourceFile = matrix.sourceFile('query')
  const declaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name)
  if (!declaration) throw new Error(`Missing fixture ${name}`)
  const checker = matrix.program.getTypeChecker()
  return extractQueryParameterDescriptor(
    checker.getTypeAtLocation(declaration.name),
    checker,
    sourceFile,
    declaration,
    name,
  )
}

function routes(id: keyof typeof sources) {
  return discoverRegisteredRoutes(matrix.program, [matrix.sourceFile(id)])
}

describe('query and registered route edge coverage', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it.each([
    ['badEnum', 'default must be one of values'],
    ['badExplode', 'explode must be false'],
    ['badItems', 'array items must be string or enum'],
    ['badBoolean', 'requires literal explode'],
    ['badTuple', 'values must contain string literals'],
  ])('rejects malformed descriptor %s', (name, message) => {
    expect(() => descriptor(name)).toThrow(message)
  })

  it('rejects conflicting fixed no-content statuses', () => {
    expect(() => routes('conflicting-status')).toThrow('Conflicting apiOpenApiNoContent statuses')
  })

  it('recognizes SSE response content type case-insensitively', () => {
    expect(routes('sse-set-type')).toMatchObject([{ kind: 'sse' }])
  })

  it('recognizes a method-not-allowed-only handler', () => {
    expect(routes('error-405')).toMatchObject([{ kind: 'error-only' }])
  })

  it.each(['declared-handler', 'parameter-handler'] as const)('rejects uninspectable %s', (id) => {
    expect(() => routes(id)).toThrow('Cannot inspect registered route handler GET:/x')
  })

  it('finds route registration through a chained middleware call', () => {
    expect(routes('chained-route')).toMatchObject([{ method: 'GET', routeTemplate: '/x' }])
  })
})
