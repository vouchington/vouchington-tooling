import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { buildOpenApiDocument, type OpenApiResponse } from '../openapi-document/index.mts'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  discoverApiResponseContracts,
  enclosingResponseEmission,
} from './response-contract-registry.mts'
import { visit } from './response-contract-route-analysis.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const sources = {
  implicit: `
    declare const app: any
    app.route('/api/v1/items').get((ctx: any) => {
      ctx.request.json()
      ctx.json({ results: [{ id: 'one' as string }] })
    })
  `,
  streamed: `
    declare const app: any
    declare function streamJsonObject<T extends object>(body: T): unknown
    app.route('/api/v1/items').get((ctx: any) => {
      ctx.pipeline(streamJsonObject({ results: [{ id: 'one' as string }] }))
    })
  `,
  'streamed-response-variants': `
    declare const app: any
    declare const source: unknown
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    declare function streamJsonObject<T extends object>(body: T): unknown
    type Item = { id: string }
    app.route('/api/v1/items').get((ctx: any) => {
      if (ctx.query.download) {
        ctx.pipeline(apiResponse('GET:/api/v1/items#download', source as Item[]))
        return
      }
      ctx.pipeline(
        streamJsonObject(apiResponse('GET:/api/v1/items#default', { results: [] as Item[] }))
      )
    })
  `,
  'raw-response': `
    declare const app: any
    declare const stream: unknown
    declare function apiOpenApiRawResponse<K extends string, T>(key: K, mediaType: string, body: T): T
    app.route('/api/v1/items/:id/raw').get((ctx: any) => {
      ctx.pipeline(apiOpenApiRawResponse('GET:/api/v1/items/:id/raw', 'message/rfc822', stream))
    })
  `,
  'non-context-pipeline': `
    declare const worker: { pipeline(value: unknown): void }
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    worker.pipeline(apiResponse('GET:/api/v1/items', { id: 'one' as string }))
  `,
  'named-handler': `
    declare const app: any
    function handle(ctx: any) { ctx.json({ id: 'one' as string }) }
    app.route('/api/v1/items/:id').get(handle)
  `,
  markers: `
    declare const app: any
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    declare function apiNoContent<K extends string>(key: K): void
    app.route('/api/v1/items').get(() => {
      apiResponse('GET:/api/v1/items', { results: [{ id: 'one' as string }] })
    })
    app.route('/api/v1/items/:id').delete(() => {
      apiNoContent('DELETE:/api/v1/items/:id')
    })
    app.route('/api/v1/items/:id/archive').put(() => {
      apiNoContent('PUT:/api/v1/items/:id/archive')
    })
  `,
  'helper-status': `
    declare const app: any
    declare const ctx: any
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    function handleImport(ctx: any) {
      ctx.setStatus(201)
      return { id: 'one' as string }
    }
    app.route('/api/v1/items').post(() => {
      apiResponse('POST:/api/v1/items', handleImport(ctx))
    })
  `,
  mismatch: `
    declare const app: any
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    app.route('/api/v1/items').get(() => apiResponse('POST:/api/v1/items', {}))
  `,
  'dynamic-key': `
    declare const app: any
    declare const key: string
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    app.route('/api/v1/items').get(() => apiResponse(key, {}))
  `,
  conflict: `
    declare const app: any
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    app.route('/api/v1/items').get(() => {
      apiResponse('GET:/api/v1/items#summary', { count: 1 })
      apiResponse('GET:/api/v1/items#summary', { count: 'one' })
    })
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

function discover(sourceId: keyof typeof sources, requestedKeys?: ReadonlySet<string>) {
  return discoverApiResponseContracts(matrix.program, [matrix.sourceFile(sourceId)], requestedKeys)
}

describe('API response contract registry', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('discovers a single-shape ctx.json handler without a marker when requested', () => {
    const contracts = discover('implicit', new Set(['GET:/api/v1/items']))

    expect(contracts['GET:/api/v1/items']).toMatchObject({
      method: 'GET',
      routeTemplate: '/api/v1/items',
      schema: { root: { type: 'object' } },
    })
  })

  it('discovers streamed JSON object handlers', () => {
    const contracts = discover('streamed', new Set(['GET:/api/v1/items']))

    expect(contracts['GET:/api/v1/items']).toMatchObject({ schema: { root: { type: 'object' } } })
  })

  it('keeps explicitly typed streamed variants available in OpenAPI', () => {
    const contracts = discover('streamed-response-variants')

    expect(Object.keys(contracts)).toEqual([
      'GET:/api/v1/items#default',
      'GET:/api/v1/items#download',
    ])
    expect(contracts['GET:/api/v1/items#default']!.schema.root.type).toBe('object')
    expect(contracts['GET:/api/v1/items#download']!.schema.root.type).toBe('array')

    const document = buildOpenApiDocument({ title: 'Example', responseContracts: contracts })
    const operation = document.paths['/api/v1/items']!.get!
    const response = operation.responses['200'] as OpenApiResponse
    expect(response.content!['application/json']!.schema.anyOf).toHaveLength(2)
    expect(operation).not.toHaveProperty('x-schema-unavailable')
    expect(document['x-unavailable-routes']).toEqual([])
  })

  it('publishes explicitly marked raw responses with their fixed media type', () => {
    const contracts = discover('raw-response')
    const document = buildOpenApiDocument({ title: 'Example', responseContracts: contracts })
    expect(contracts['GET:/api/v1/items/:id/raw']).toMatchObject({
      mediaType: 'message/rfc822',
      statusKnowledge: 'default',
      schema: { root: { type: 'string', format: 'binary' } },
    })
    const response = document.paths['/api/v1/items/{id}/raw']!.get!.responses[
      '200'
    ] as OpenApiResponse

    expect(response).toMatchObject({
      content: { 'message/rfc822': { schema: { type: 'string', format: 'binary' } } },
    })
    expect(document['x-unavailable-routes']).toEqual([])
  })

  it('does not treat a non-ctx pipeline enclosing an explicit marker as a response emission', () => {
    const sourceFile = matrix.sourceFile('non-context-pipeline')
    let marker: ts.CallExpression | undefined
    visit(sourceFile, (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'apiResponse'
      )
        marker = node
    })

    expect(marker).toBeDefined()
    expect(enclosingResponseEmission(marker!)).toBeUndefined()
  })

  it('binds named route handlers to their registered method and route', () => {
    const contracts = discover('named-handler', new Set(['GET:/api/v1/items/:itemId']))

    expect(contracts['GET:/api/v1/items/:itemId']).toMatchObject({
      routeTemplate: '/api/v1/items/:id',
    })
  })

  it('discovers typed response and no-content markers with their route bindings', () => {
    const contracts = discover('markers')

    expect(contracts['GET:/api/v1/items']).toMatchObject({
      method: 'GET',
      routeTemplate: '/api/v1/items',
      schema: { root: { type: 'object' } },
    })
    expect(contracts['DELETE:/api/v1/items/:id']).toMatchObject({
      method: 'DELETE',
      routeTemplate: '/api/v1/items/:id',
      statusKnowledge: 'default',
      schema: { root: { type: 'null' } },
    })
    expect(contracts['PUT:/api/v1/items/:id/archive']).toMatchObject({
      statusKnowledge: 'default',
      schema: { root: { type: 'null' } },
    })
  })

  it('does not fall back to a helper-owned route-wide status for a marker call', () => {
    const contracts = discover('helper-status')

    expect(contracts['POST:/api/v1/items']!.statusCodes).toBeUndefined()
  })

  it('requires literal keys that match the enclosing route and method', () => {
    expect(() => discover('mismatch')).toThrow('does not match enclosing route GET:/api/v1/items')

    expect(() => discover('dynamic-key')).toThrow('literal contract key')
  })

  it('allows explicit variants but rejects one key resolving to multiple schemas', () => {
    expect(() => discover('conflict')).toThrow('multiple backend response schemas')
  })
})
