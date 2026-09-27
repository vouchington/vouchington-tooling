import { beforeAll, describe, expect, it } from 'vitest'

import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from '../contract-schema/index.mts'
import { discoverAppRouteCtxContractsV1 } from './index.mts'

const sources = {
  alpha: `
    declare const app: any
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    declare function apiRequest<K extends string, T>(key: K, body: T): T
    declare function apiQuery<K extends string, T>(key: K, carrier: T): T
    declare function apiHeaders<K extends string, T>(key: K, headers: T): T
    type UuidBrand = string & { readonly __uuidBrand: never }
    const paging = { queryContract: { size: { kind: 'integer', minimum: 1, maximum: 20 } } } as const
    app.route('/items/:id').post((ctx: any) => {
      apiRequest('POST:/items/:id', { name: 'sample' as string })
      apiQuery('POST:/items/:id', paging)
      apiHeaders('POST:/items/:id', { request: { 'x-request-id': { type: 'string', required: true } } })
      ctx.setStatus(201)
      ctx.json(apiResponse('POST:/items/:id', { id: '' as UuidBrand }))
    })
  `,
  beta: `
    declare const app: any
    app.route('/widgets').get((ctx: any) => {
      ctx.json({ count: 3 as number })
    })
  `,
  invalid: `
    declare const app: any
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    app.route('/broken').get((ctx: any) => {
      ctx.json(apiResponse('GET:/other', { ok: true }))
    })
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

describe('app.route/ctx contract discovery v1', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, 15_000)

  it('discovers response, request, query, header, and route contracts for independent consumers', () => {
    const input = [matrix.sourceFile('alpha'), matrix.sourceFile('beta')]
    const result = discoverAppRouteCtxContractsV1({
      program: matrix.program,
      sourceFiles: input,
      options: { formatAliases: { UuidBrand: 'uuid' } },
    })
    expect(result.adapterVersion).toBe(1)
    expect(result.routes.map((route) => `${route.method}:${route.routeTemplate}`)).toEqual([
      'GET:/widgets',
      'POST:/items/:id',
    ])
    expect(result.responses['POST:/items/:id']).toMatchObject({
      statusCodes: [201],
      mediaType: 'application/json',
      schema: { root: { properties: { id: { schema: { format: 'uuid' } } } } },
    })
    expect(result.requests['POST:/items/:id']?.schema.root).toMatchObject({ type: 'object' })
    expect(result.queries['POST:/items/:id']?.parameters.size).toEqual({
      kind: 'integer',
      minimum: 1,
      maximum: 20,
    })
    expect(result.headers['POST:/items/:id']?.requestHeaders['x-request-id']).toEqual({
      type: 'string',
      required: true,
    })
    expect(result.responses['GET:/widgets']?.schema.root).toMatchObject({ type: 'object' })
  })

  it('fails when a marker claims another route', () => {
    expect(() =>
      discoverAppRouteCtxContractsV1({
        program: matrix.program,
        sourceFiles: [matrix.sourceFile('invalid')],
      }),
    ).toThrow(/does not match enclosing route GET:\/broken/)
  })
})
