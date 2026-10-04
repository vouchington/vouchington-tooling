import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const sources = {
  variants: `
    declare const app: any
    declare const format: string
    declare const stream: unknown
    declare function risky(): any
    app.route('/api/v1/export').get((ctx: any) => {
      if (format === 'json') { ctx.json({ results: [] as string[] }); return }
      if (format === 'csv') {
        ctx.set('Content-Type', 'text/csv; charset=utf-8')
        ctx.pipeline(stream)
        return
      }
      if (format === 'broken') { ctx.json({ value: risky() }); return }
      ctx.response.xml('<opml />' as string)
    })
  `,
  setters: `
    declare const app: any
    declare const stream: unknown
    declare const dynamicType: string
    app.route('/api/v1/enclosing').get((ctx: any) => {
      ctx.set('Content-Type', 'text/csv; charset=utf-8')
      if (ctx.query.download) { ctx.pipeline(stream) }
    })
    app.route('/api/v1/xml-stream').get((ctx: any) => {
      ctx.set('Content-Type', 'application/xml; charset=utf-8')
      ctx.pipeline(stream)
    })
    app.route('/api/v1/overwritten').get((ctx: any) => {
      ctx.set('Content-Type', 'text/csv')
      ctx.set('Content-Type', 'application/octet-stream')
      ctx.pipeline(stream)
    })
    app.route('/api/v1/dynamic').get((ctx: any) => {
      ctx.set('Content-Type', dynamicType)
      ctx.pipeline(stream)
    })
  `,
  'marked-streams': `
    declare const app: any
    declare function apiResponse<K extends string, T>(key: K, body: T): T
    app.route('/api/v1/csv').get((ctx: any) => {
      ctx.set('Content-Type', 'text/csv; charset=utf-8')
      ctx.pipeline(apiResponse('GET:/api/v1/csv', { id: 'one' }))
    })
    app.route('/api/v1/xml').get((ctx: any) => {
      ctx.set('Content-Type', 'application/xml; charset=utf-8')
      ctx.pipeline(apiResponse('GET:/api/v1/xml', { id: 'one' }))
    })
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

describe('API response media contracts', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('separates JSON, XML, and CSV media while retaining failed secondary variants', () => {
    const contracts = discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile('variants')],
      undefined,
      { onRouteError: () => {} },
    )
    expect(
      Object.values(contracts)
        .map((contract) => contract.mediaType)
        .filter((value): value is string => Boolean(value))
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(['application/json', 'application/json', 'application/xml', 'text/csv'])
    expect(Object.values(contracts).some((contract) => contract.unavailableReason)).toBe(true)
  })

  it('uses the nearest active-branch Content-Type setter for raw pipelines', () => {
    const contracts = discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile('setters')],
      undefined,
      { onRouteError: () => {} },
    )
    expect(contracts['GET:/api/v1/enclosing']!.mediaType).toBe('text/csv')
    expect(contracts['GET:/api/v1/xml-stream']!.mediaType).toBe('application/xml')
    expect(contracts['GET:/api/v1/overwritten']!.unavailableReason).toBeDefined()
    expect(contracts['GET:/api/v1/dynamic']!.unavailableReason).toBeDefined()
    expect(contracts['GET:/api/v1/overwritten']!.mediaTypeKnowledge).toBe('unknown')
    expect(contracts['GET:/api/v1/dynamic']!.mediaTypeKnowledge).toBe('unknown')
  })

  it('retains CSV/XML media inference for pipelines containing explicit response markers', () => {
    const sourceFile = matrix.sourceFile('marked-streams')
    const normal = discoverApiResponseContracts(matrix.program, [sourceFile])
    const strict = discoverApiResponseContracts(matrix.program, [sourceFile], undefined, {
      onAmbiguousAttribution: () => {},
    })

    expect(strict).toEqual(normal)
    expect(normal['GET:/api/v1/csv#implicit-2']?.mediaType).toBe('text/csv')
    expect(normal['GET:/api/v1/xml#implicit-2']?.mediaType).toBe('application/xml')
  })
})
