import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import { discoverApiRequestContracts } from './request-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const sources = {
  parser: `
    declare const app: any
    declare function parseJsonBody<T>(ctx: any, maxSize?: string): Promise<T>
    app.route('/api/v1/items').post(async (ctx: any) => {
      const body = await parseJsonBody<{ name: string }>(ctx)
      ctx.json({ id: 'one' as string, name: body.name })
    })
  `,
  cast: `
    declare const app: any
    app.route('/api/v1/items').post(async (ctx: any) => {
      const body = (await ctx.request.json('1mb')) as { name: string }
      ctx.json({ id: 'one' as string, name: body.name })
    })
  `,
  catch: `
    declare const app: any
    app.route('/api/v1/items').post(async (ctx: any) => {
      const body = (await ctx.request.json('10kb').catch(() => ({}))) as { token?: string }
      ctx.json({ id: 'one' as string, hasToken: typeof body.token === 'string' })
    })
  `,
  wrapper: `
    declare const app: any
    declare function parseFoo(input: unknown): { name: string }
    type FakeRequest = { json<T = unknown>(limit?: string): Promise<T> }
    type FakeContext = { request: FakeRequest; json: (body: unknown) => void }
    app.route('/api/v1/items').post(async (ctx: FakeContext) => {
      const body = parseFoo(await ctx.request.json('1mb'))
      ctx.json({ id: 'one' as string, name: body.name })
    })
  `,
  buffer: `
    declare const app: any
    app.route('/api/v1/webhooks/stripe').post(async (ctx: any) => {
      const rawBody = await ctx.request.buffer('1mb')
      ctx.json({ received: true as boolean })
    })
  `,
  'buffer-after-body': `
    declare const app: any
    declare const flag: boolean
    app.route('/api/v1/items').post(async (ctx: any) => {
      if (flag) {
        const body = (await ctx.request.json('1mb')) as { name: string }
        ctx.json({ id: 'one' as string, name: body.name })
        return
      }
      const rawBody = await ctx.request.buffer('1mb')
      ctx.json({ received: true as boolean })
    })
  `,
  markers: `
    declare const app: any
    declare function apiRequest<K extends string, T>(key: K, body: T): T
    declare function apiRequestContract<K extends string, T>(key: K): void
    declare function apiNoRequestBody<K extends string>(key: K): void
    app.route('/api/v1/items').post(async (ctx: any) => {
      const body = apiRequest(
        'POST:/api/v1/items',
        (await ctx.request.json('1mb')) as { name: string },
      )
      ctx.json({ id: 'one' as string, name: body.name })
    })
    app.route('/api/v1/items/:id').patch(async (ctx: any) => {
      apiNoRequestBody('PATCH:/api/v1/items/:id')
      await ctx.request.json('1mb')
      ctx.json({ id: 'one' as string })
    })
    app.route('/api/v1/items/:id/vote').put(async (ctx: any) => {
      apiRequestContract<'PUT:/api/v1/items/:id/vote', { choice: 'one' | 'two' }>(
        'PUT:/api/v1/items/:id/vote',
      )
      await ctx.request.json('10kb')
      ctx.json({ id: 'one' as string })
    })
  `,
  variant: `
    declare const app: any
    declare function apiRequest<K extends string, T>(key: K, body: T): T
    app.route('/api/v1/items').post(() => apiRequest('POST:/api/v1/items#variant', {}))
  `,
  conflict: `
    declare const app: any
    declare function apiRequest<K extends string, T>(key: K, body: T): T
    app.route('/api/v1/items').post(() => {
      apiRequest('POST:/api/v1/items', { count: 1 })
      apiRequest('POST:/api/v1/items', { count: 'one' })
    })
  `,
  'implicit-conflict': `
    declare const app: any
    declare const flag: boolean
    app.route('/api/v1/items').post(async (ctx: any) => {
      if (flag) {
        const first = (await ctx.request.json('1mb')) as { name: string }
        ctx.json({ id: 'one' as string, name: first.name })
        return
      }
      const second = (await ctx.request.json('1mb')) as { count: number }
      ctx.json({ id: 'one' as string, count: second.count })
    })
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

function discover(sourceId: keyof typeof sources, requestedKeys?: ReadonlySet<string>) {
  return discoverApiRequestContracts(matrix.program, [matrix.sourceFile(sourceId)], requestedKeys)
}

describe('API request contract registry', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('discovers parseJsonBody<T>(ctx) as the route body', () => {
    const contracts = discover('parser', new Set(['POST:/api/v1/items']))

    expect(contracts['POST:/api/v1/items']).toMatchObject({
      method: 'POST',
      routeTemplate: '/api/v1/items',
      schema: { root: { type: 'object', properties: { name: { schema: { type: 'string' } } } } },
    })
  })

  it('discovers (await ctx.request.json(...)) as T', () => {
    const contracts = discover('cast', new Set(['POST:/api/v1/items']))

    expect(contracts['POST:/api/v1/items']).toMatchObject({
      schema: { root: { type: 'object', properties: { name: { schema: { type: 'string' } } } } },
    })
  })

  it('discovers a .catch()-guarded cast', () => {
    const contracts = discover('catch', new Set(['POST:/api/v1/items']))

    expect(contracts['POST:/api/v1/items']).toMatchObject({
      schema: { root: { properties: { token: { required: false } } } },
    })
  })

  it('treats a wrapper-parsed body with no enclosing cast as an honest untyped success', () => {
    const contracts = discover('wrapper', new Set(['POST:/api/v1/items']))

    const contract = contracts['POST:/api/v1/items']!
    expect(contract.schema.root).toEqual({ type: 'unknown' })
    expect(contract.unavailableReason).toBeUndefined()
  })

  it('marks a raw buffer read unavailable', () => {
    const contracts = discover('buffer', new Set(['POST:/api/v1/webhooks/stripe']))

    expect(contracts['POST:/api/v1/webhooks/stripe']!.unavailableReason).toBeDefined()
  })

  it('marks a route unavailable when a buffer read is found after a body was already harvested, regardless of order', () => {
    const contracts = discover('buffer-after-body', new Set(['POST:/api/v1/items']))

    expect(contracts['POST:/api/v1/items']!.unavailableReason).toBeDefined()
  })

  it('discovers explicit request markers, with a marker always winning over a harvest', () => {
    const contracts = discover('markers')

    expect(contracts['POST:/api/v1/items']).toMatchObject({
      schema: { root: { properties: { name: { schema: { type: 'string' } } } } },
    })
    expect(contracts['PATCH:/api/v1/items/:id']).toBeUndefined()
    expect(contracts['PUT:/api/v1/items/:id/vote']).toMatchObject({
      schema: {
        root: {
          properties: { choice: { schema: { type: 'union' } } },
        },
      },
    })
  })

  it('requires literal keys that match the enclosing route exactly, with no #variant escape hatch', () => {
    expect(() => discover('variant')).toThrow('does not match enclosing route POST:/api/v1/items')
  })

  it('rejects two conflicting explicit apiRequest markers at the same key', () => {
    expect(() => discover('conflict')).toThrow('multiple backend request schemas')
  })

  it('swallows a second implicit harvest that conflicts with the first, keeping the first contract', () => {
    const contracts = discover('implicit-conflict', new Set(['POST:/api/v1/items']))

    expect(contracts['POST:/api/v1/items']).toMatchObject({
      schema: { root: { properties: { name: { required: true } } } },
    })
  })
})
