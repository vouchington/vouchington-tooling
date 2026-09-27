import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import { discoverRegisteredRoutes } from './registered-route-catalog.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const openApiMarkerPreamble = `
  declare const app: any
  declare const responseStatus: number
  declare function apiOpenApiNoContent(key: string, status: number): void
`
const sources = {
  fixed: `
    ${openApiMarkerPreamble}
    app.route('/api/v1/callback').get(() => {
      apiOpenApiNoContent('GET:/api/v1/callback', 302)
    })
  `,
  'mismatched-key': `
    ${openApiMarkerPreamble}
    app.route('/api/v1/callback').get(() => {
      apiOpenApiNoContent('GET:/api/v1/other', 302)
    })
  `,
  'dynamic-status': `
    ${openApiMarkerPreamble}
    app.route('/api/v1/callback').get(() => {
      apiOpenApiNoContent('GET:/api/v1/callback', responseStatus)
    })
  `,
  'sse-conflict': `
    declare const app: any
    declare const ctx: any
    declare function apiOpenApiNoContent(key: string, status: number): void
    declare function startSSE(ctx: unknown): unknown
    app.route('/api/v1/callback').get(() => {
      apiOpenApiNoContent('GET:/api/v1/callback', 302)
      startSSE(ctx)
    })
  `,
  duplicate: `
    declare const app: any
    app.route('/api/v1/items/:id').get(() => {})
    app.route('/api/v1/items/:itemId').get(() => {})
  `,
  opaque: `
    declare const app: any
    declare function createHandler(): () => void
    app.route('/api/v1/events').get(createHandler())
  `,
  factory: `
    declare const app: any
    declare function startSSE(ctx: unknown): unknown
    function createHandler() {
      return (ctx: unknown) => startSSE(ctx)
    }
    app.route('/api/v1/events').get(createHandler())
  `,
  composed: `
    declare const app: any
    declare function startSSE(ctx: unknown): unknown
    const eventHandler = (ctx: unknown) => startSSE(ctx)
    function wrap<T>(handler: T): T {
      return handler
    }
    app.route('/api/v1/events').get(wrap(eventHandler))
  `,
  arrow: `
    declare const app: any
    declare function startSSE(ctx: unknown): unknown
    const eventHandler = (ctx: unknown) => startSSE(ctx)
    const wrap = <T>(handler: T): T => handler
    app.route('/api/v1/events').get(wrap(eventHandler))
  `,
  outside: `
    declare const app: any
    declare const ctx: unknown
    declare function startSSE(ctx: unknown): unknown
    function createHandler(useEvents: boolean) {
      if (useEvents) startSSE(ctx)
      return () => undefined
    }
    app.route('/api/v1/events').get(createHandler(false))
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

function routes(sourceId: keyof typeof sources) {
  return discoverRegisteredRoutes(matrix.program, [matrix.sourceFile(sourceId)])
}

describe('registered route catalog', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('captures an OpenAPI-only fixed no-content marker', () => {
    expect(routes('fixed')).toMatchObject([{ kind: 'fixed-no-content', fixedStatus: 302 }])
  })

  it('rejects mismatched keys and dynamic statuses on OpenAPI-only markers', () => {
    for (const [sourceId, expectedMessage] of [
      [
        'mismatched-key',
        'apiOpenApiNoContent key must match registered route GET:/api/v1/callback',
      ],
      ['dynamic-status', 'apiOpenApiNoContent status requires a numeric literal'],
    ] as const) {
      expect(() => routes(sourceId)).toThrow(expectedMessage)
    }
  })

  it('rejects a fixed no-content marker combined with SSE handling', () => {
    expect(() => routes('sse-conflict')).toThrow(
      'apiOpenApiNoContent conflicts with SSE response handling for GET:/api/v1/callback',
    )
  })

  it('rejects duplicate registrations after parameter-name normalization', () => {
    expect(() => routes('duplicate')).toThrow('Duplicate registered API route')
  })

  it('rejects handler factories whose response behavior cannot be inspected', () => {
    expect(() => routes('opaque')).toThrow(
      'Cannot inspect registered route handler GET:/api/v1/events',
    )
  })

  it('classifies response behavior inside an inspectable handler factory', () => {
    expect(routes('factory')).toMatchObject([{ kind: 'sse' }])
  })

  it('follows handler arguments returned by composed factories', () => {
    expect(routes('composed')).toMatchObject([{ kind: 'sse' }])
  })

  it('follows handler arguments returned by arrow-function factories', () => {
    expect(routes('arrow')).toMatchObject([{ kind: 'sse' }])
  })

  it('ignores response behavior outside the handler returned by a factory', () => {
    expect(routes('outside')).toMatchObject([{ kind: 'ordinary' }])
  })
})
