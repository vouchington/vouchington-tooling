import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'

import { enclosingRequestBodyCast } from './request-contract-route-analysis.mts'
import {
  registerRequestContract,
  registerRequestRouteContract,
} from './request-contract-lenient.mts'
import { discoverApiRequestContracts } from './request-contract-registry.mts'
import { registerRouteContract } from './response-contract-lenient.mts'
import { streamingTextMediaType } from './response-contract-media.mts'
import { noContentContract } from './response-contract-registration.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import {
  buildVirtualProgramMatrix,
  COLD_VIRTUAL_PROGRAM_TIMEOUT_MS,
  type VirtualProgramMatrix,
} from './test-setup.test-helpers.mts'

const sources = {
  'request-implicit': `
    declare const app: any
    declare function parseJsonBody<T>(ctx: any): Promise<T>
    app.route('/x').post(async (ctx: any) => { await parseJsonBody<{ id: string }>(ctx) })
  `,
  'request-explicit': `
    declare const app: any
    declare function apiRequest(key: string, body: unknown): void
    app.route('/x').post(() => apiRequest('POST:/x', { id: 'one' as string }))
  `,
  'response-duplicate': `
    declare const app: any
    declare function apiNoContent(key: string): void
    app.route('/x').get(() => {
      apiNoContent('GET:/x')
      apiNoContent('GET:/x')
    })
  `,
  'response-no-body': `
    declare const app: any
    declare function apiResponse(key: string, body?: unknown): void
    app.route('/x').get(() => apiResponse('GET:/x'))
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

function request(id: keyof typeof sources, requestedKeys?: ReadonlySet<string>) {
  return discoverApiRequestContracts(matrix.program, [matrix.sourceFile(id)], requestedKeys)
}

function response(id: keyof typeof sources) {
  return discoverApiResponseContracts(matrix.program, [matrix.sourceFile(id)])
}

function callFrom(source: string): ts.CallExpression {
  const file = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.ESNext, true)
  let call: ts.CallExpression | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) call = node
    node.forEachChild(visit)
  }
  visit(file)
  if (!call) throw new Error('Missing fixture call')
  return call
}

describe('request and response branch boundaries', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('does not harvest an implicit body for an unrequested route', () => {
    expect(request('request-implicit', new Set(['POST:/other']))).toEqual({})
  })

  it('accepts an identical request contract registered twice', () => {
    const contract = request('request-explicit')['POST:/x']!
    const contracts = new Map([['POST:/x', contract]])
    registerRequestContract(contracts, 'POST:/x', contract)
    expect(contracts.get('POST:/x')).toBe(contract)
  })

  it('reports a non-Error extraction failure as an unavailable request', () => {
    const errors: string[] = []
    const contracts = new Map()
    registerRequestRouteContract(
      contracts,
      'POST:/x',
      { method: 'POST', routeTemplate: '/x' },
      'fixture.ts',
      () => {
        throw 'unextractable body'
      },
      { onRouteError: (error) => errors.push(error.reason) },
    )
    expect(errors).toEqual(['unextractable body'])
    expect(contracts.get('POST:/x')).toMatchObject({ unavailableReason: 'unextractable body' })
  })

  it('returns no body cast for a detached call expression', () => {
    const call = ts.factory.createCallExpression(ts.factory.createIdentifier('read'), undefined, [])
    expect(enclosingRequestBodyCast(call)).toBeUndefined()
  })

  it('allows duplicate identical response markers', () => {
    expect(response('response-duplicate')['GET:/x']).toMatchObject({ bodyKind: 'none' })
  })

  it('rejects a response marker without a body', () => {
    expect(() => response('response-no-body')).toThrow('apiResponse requires a response body')
  })

  it('returns no streaming media outside a block', () => {
    expect(streamingTextMediaType(callFrom('ctx.pipeline(stream)'))).toBeUndefined()
  })

  it('ignores a preceding non-set call when finding streaming media', () => {
    expect(
      streamingTextMediaType(callFrom('{ ctx.json({}); ctx.pipeline(stream) }')),
    ).toBeUndefined()
  })

  it('registers a response without optional emission metadata', () => {
    const contracts = new Map()
    registerRouteContract(
      contracts,
      'GET:/x',
      { method: 'GET', routeTemplate: '/x' },
      'fixture.ts',
      {},
      () => noContentContract('fixture.ts'),
      undefined,
    )
    expect(contracts.get('GET:/x')).toEqual({
      ...noContentContract('fixture.ts'),
      method: 'GET',
      routeTemplate: '/x',
    })
  })

  it('reports a non-Error extraction failure as an unavailable response', () => {
    const errors: string[] = []
    const contracts = new Map()
    registerRouteContract(
      contracts,
      'GET:/x',
      { method: 'GET', routeTemplate: '/x' },
      'fixture.ts',
      {},
      () => {
        throw 'unextractable response'
      },
      { onRouteError: (error) => errors.push(error.reason) },
    )
    expect(errors).toEqual(['unextractable response'])
    expect(contracts.get('GET:/x')).toMatchObject({ unavailableReason: 'unextractable response' })
  })
})
