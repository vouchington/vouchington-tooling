import { beforeAll, describe, expect, it, vi } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'

import { discoverApiRequestContracts } from './request-contract-registry.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { resolveEmissionStatus } from './response-contract-status.mts'
import {
  buildVirtualProgramMatrix,
  COLD_VIRTUAL_PROGRAM_TIMEOUT_MS,
  type VirtualProgramMatrix,
} from './test-setup.test-helpers.mts'

const sources = {
  'request-no-key': `
    declare const app: any
    declare function apiRequest(key?: string, body?: unknown): void
    app.route('/x').post(() => apiRequest())
  `,
  'request-outside': `
    declare function apiNoRequestBody(key: string): void
    apiNoRequestBody('POST:/x')
  `,
  'request-no-body': `
    declare const app: any
    declare function apiRequest(key: string, body?: unknown): void
    app.route('/x').post(() => apiRequest('POST:/x'))
  `,
  'request-no-type': `
    declare const app: any
    declare function apiRequestContract<K extends string, T = unknown>(key: K): void
    app.route('/x').post(() => apiRequestContract<'POST:/x'>('POST:/x'))
  `,
  'request-bad-body': `
    declare const app: any
    declare function apiRequest(key: string, body: unknown): void
    declare const body: any
    app.route('/x').post(() => apiRequest('POST:/x', body))
  `,
  'request-second-bad-read': `
    declare const app: any
    declare function parseJsonBody<T>(ctx: any): Promise<T>
    app.route('/x').post(async (ctx: any) => {
      await parseJsonBody<{ name: string }>(ctx)
      await parseJsonBody<any>(ctx)
    })
  `,
  'response-outside': `
    declare function apiResponse(key: string, body: unknown): void
    apiResponse('GET:/x', { value: 'x' })
  `,
  'response-no-media': `
    declare const app: any
    declare function apiOpenApiRawResponse(key: string, media?: string): void
    app.route('/x').get(() => apiOpenApiRawResponse('GET:/x'))
  `,
  'response-nonliteral-media': `
    declare const app: any
    declare const media: string
    declare function apiOpenApiRawResponse(key: string, media: string): void
    app.route('/x').get(() => apiOpenApiRawResponse('GET:/x', media))
  `,
  'response-unrelated-setters': `
    declare const app: any
    declare const stream: unknown
    app.route('/x').get((ctx: any) => {
      const unrelated = 1
      ctx.set('Accept', 'text/csv')
      ctx.pipeline(stream)
    })
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

function request(
  id: keyof typeof sources,
  options?: Parameters<typeof discoverApiRequestContracts>[3],
) {
  return discoverApiRequestContracts(matrix.program, [matrix.sourceFile(id)], undefined, options)
}

function response(id: keyof typeof sources) {
  return discoverApiResponseContracts(matrix.program, [matrix.sourceFile(id)])
}

describe('request and response registry edge coverage', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it.each([
    ['request-no-key', 'apiRequest requires a literal contract key'],
    ['request-outside', 'apiNoRequestBody must be inside an app.route handler'],
    ['request-no-body', 'apiRequest requires a request body'],
    ['request-no-type', 'apiRequestContract requires a request body type'],
  ] as const)('rejects %s', (id, message) => {
    expect(() => request(id)).toThrow(message)
  })

  it('reports an invalid explicit body and preserves an unavailable route contract', () => {
    const errors: string[] = []
    expect(() => request('request-bad-body')).toThrow('any is not allowed')
    const contracts = request('request-bad-body', {
      onRouteError: (error) => errors.push(error.reason),
    })
    expect(errors).toEqual([expect.stringContaining('any is not allowed')])
    expect(contracts['POST:/x']).toMatchObject({
      method: 'POST',
      routeTemplate: '/x',
      unavailableReason: expect.stringContaining('any is not allowed'),
    })
  })

  it('keeps the first implicit contract when a later body read cannot be extracted', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const contracts = request('request-second-bad-read')
      expect(contracts['POST:/x']!.schema.root).toMatchObject({ type: 'object' })
      expect(warning).toHaveBeenCalledWith(
        'Second body-read extraction for "POST:/x" failed:',
        expect.objectContaining({ message: expect.stringContaining('any is not allowed') }),
      )
    } finally {
      warning.mockRestore()
    }
  })

  it('rejects response markers outside a registered route', () => {
    expect(() => response('response-outside')).toThrow(
      'apiResponse must be inside an app.route handler',
    )
  })

  it.each(['response-no-media', 'response-nonliteral-media'] as const)(
    'requires a literal raw media type for %s',
    (id) => {
      expect(() => response(id)).toThrow('apiOpenApiRawResponse requires a literal media type')
    },
  )

  it('ignores unrelated statements and non-Content-Type setters before a stream', () => {
    const contract = response('response-unrelated-setters')['GET:/x']!
    expect(contract.mediaTypeKnowledge).toBe('unknown')
  })

  it('marks a status setter without an argument as unknown', () => {
    const source = ts.createSourceFile('status.ts', 'ctx.setStatus()', ts.ScriptTarget.ESNext, true)
    const call = (source.statements[0] as ts.ExpressionStatement).expression as ts.CallExpression
    expect(resolveEmissionStatus(call)).toEqual({
      statusKnowledge: 'unknown',
      unavailableReason: 'ctx.setStatus has no statically known status',
    })
  })
})
