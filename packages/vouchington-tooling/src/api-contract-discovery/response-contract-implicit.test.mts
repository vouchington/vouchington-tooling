import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  discoverApiResponseContracts,
  type DiscoverApiResponseContractsOptions,
} from './response-contract-registry.mts'
import { responseContractImplicitSources as sources } from './response-contract-implicit-sources.test-helpers.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

let matrix: VirtualProgramMatrix<keyof typeof sources>

function discover(
  sourceId: keyof typeof sources,
  requestedKeys?: ReadonlySet<string>,
  options?: DiscoverApiResponseContractsOptions,
) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(sourceId)],
    requestedKeys,
    options,
  )
}

describe('API response contract registry — implicit bodies and status capture', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('does not infer response status from a called helper', () => {
    const contracts = discover('called-helper', new Set(['POST:/api/v1/items']))

    expect(contracts['POST:/api/v1/items']!.statusCodes).toBeUndefined()
  })

  it('does not attribute a status to a helper function called from two different routes', () => {
    const contracts = discover(
      'shared-helper',
      new Set(['POST:/api/v1/items', 'POST:/api/v1/widgets']),
    )

    expect(contracts['POST:/api/v1/items']!.statusCodes).toBeUndefined()
    expect(contracts['POST:/api/v1/widgets']!.statusCodes).toBeUndefined()
  })

  it('treats ctx.response.empty() as no-content regardless of the preceding literal status', () => {
    const contracts = discover('empty', new Set(['DELETE:/api/v1/items/:id']))

    expect(contracts['DELETE:/api/v1/items/:id']).toMatchObject({
      statusCodes: [200],
      schema: { root: { type: 'null' } },
    })
  })

  it('skips a hand-rolled early-return error guard and registers the trailing success body instead', () => {
    const contracts = discover('error-guard', new Set(['GET:/api/v1/auth/me']))

    const contract = contracts['GET:/api/v1/auth/me']!
    // Would fail if the error branch's `{ error }` body won the bare key instead: that shape has
    // no `user` property.
    expect(contract).toMatchObject({
      schema: { root: { properties: { user: { required: true } } } },
    })
    // The 401 literal must not leak through as the route's documented status.
    expect(contract.statusCodes).toBeUndefined()
  })

  it('still registers a trailing success body after two independent, self-contained early-return guards', () => {
    const contracts = discover('two-guards', new Set(['GET:/api/v1/items/:itemId']))

    const contract = contracts['GET:/api/v1/items/:itemId']!
    expect(contract).toMatchObject({
      schema: { root: { properties: { item: { required: true } } } },
    })
    expect(contract.statusCodes).toBeUndefined()
  })

  it('skips both branches of a shared conflict helper that sets its error status before an inner if', () => {
    const contracts = discover('conflict', new Set(['POST:/api/v1/items']))

    const contract = contracts['POST:/api/v1/items']!
    // Would fail if either of sendConflict's `{ error }` bodies won the bare key instead: neither
    // shape has an `id`/`status` pair, and the 409 must not leak through as the route's status.
    expect(contract).toMatchObject({
      statusCodes: [201],
      schema: { root: { properties: { id: { required: true }, status: { required: true } } } },
    })
  })

  it('captures both branches of a ternary setStatus as primary + alternate statuses', () => {
    const contracts = discover('ternary', new Set(['POST:/api/v1/items']))

    expect(contracts['POST:/api/v1/items']).toMatchObject({ statusCodes: [200, 201] })
  })

  it('resolves each explicit-marker variant to its own preceding status, not the route-wide status', () => {
    const contracts = discover('variants')

    expect(contracts['POST:/api/v1/items#validation']).toMatchObject({ statusCodes: [422] })
    expect(contracts['POST:/api/v1/items']).toMatchObject({ statusCodes: [201] })
  })

  it('collects multiple distinct unmarked success bodies from separate branches of one route', () => {
    const contracts = discover('branches')

    const variants = Object.entries(contracts).filter(
      ([, contract]) =>
        contract.method === 'POST' && contract.routeTemplate === '/api/v1/webhooks/:id',
    )
    expect(variants).toHaveLength(2)
    expect(variants.map(([, contract]) => contract.unavailableReason)).toEqual([
      undefined,
      undefined,
    ])
  })

  it('retains a failed secondary implicit variant so the operation becomes unavailable', () => {
    const errors: unknown[] = []
    const contracts = discover('secondary-failure', undefined, {
      onRouteError: (error) => errors.push(error),
    })

    expect(Object.keys(contracts)).toEqual([
      'GET:/api/v1/jobs/:id',
      'GET:/api/v1/jobs/:id#implicit-2',
    ])
    const contract = contracts['GET:/api/v1/jobs/:id']!
    expect(contract.unavailableReason).toBeUndefined()
    expect(contract.schema.root).toMatchObject({ properties: { ready: { required: true } } })
    expect(contracts['GET:/api/v1/jobs/:id#implicit-2']!.unavailableReason).toBeDefined()
    expect(errors).toHaveLength(1)
  })

  it.each([
    ['empty then buffer', 'empty-then-buffer'],
    ['buffer then empty', 'buffer-then-empty'],
  ] as const)(
    'marks a route unavailable instead of a false 204, regardless of branch visit order (%s)',
    (_label, sourceId) => {
      const contracts = discover(sourceId, new Set(['POST:/api/v1/mcp']))

      expect(contracts['POST:/api/v1/mcp']!.unavailableReason).toBeDefined()
    },
  )

  it('still reports a genuine failure when a route has only one, unextractable implicit body', () => {
    const errors: unknown[] = []
    const contracts = discover('single-failure', undefined, {
      onRouteError: (error) => errors.push(error),
    })

    expect(contracts['GET:/api/v1/jobs/:id']!.unavailableReason).toBeDefined()
    expect(errors).toHaveLength(1)
  })
})
