import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import type { BackendResponseContract } from './response-contract-types.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const sources = {
  sibling: `
    declare const app: any
    declare const remove: boolean
    app.route('/api/v1/items/:id').patch((ctx: any) => {
      if (remove) { ctx.setStatus(204); return }
      ctx.json({ item: { id: 'one' as string } })
    })
  `,
  dynamic: `
    declare const app: any
    declare const responseStatus: number
    app.route('/api/v1/items').get((ctx: any) => {
      ctx.setStatus(responseStatus)
      ctx.json({ ok: true as boolean })
    })
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

describe('API response status contracts', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('normalizes contract-specific statuses for fixture and OpenAPI consumers', () => {
    const content = contract()
    expect(responseStatusCodesForContract(content)).toEqual([200])
    expect(
      responseStatusCodesForContract(
        contract({ statusCodes: [202, 201, 202], statusKnowledge: 'explicit' }),
      ),
    ).toEqual([201, 202])
    expect(
      responseStatusCodesForContract(
        contract({
          bodyKind: 'none',
          schema: { root: { type: 'string' }, definitions: {} },
        }),
      ),
    ).toEqual([204])
    expect(
      responseStatusCodesForContract(
        contract({
          schema: { root: { type: 'null' }, definitions: {} },
        }),
      ),
    ).toEqual([204])
    expect(
      responseStatusCodesForContract(contract({ statusCodes: [201], statusKnowledge: 'unknown' })),
    ).toEqual([])
  })

  it('keeps sibling statuses local and rejects a dynamic nearest status', () => {
    const sibling = discoverApiResponseContracts(matrix.program, [matrix.sourceFile('sibling')])
    expect(Object.values(sibling).find((value) => value.bodyKind === 'none')?.statusCodes).toEqual([
      204,
    ])
    expect(
      Object.values(sibling).find((value) => value.bodyKind === 'content')?.statusCodes,
    ).toBeUndefined()

    const dynamic = discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile('dynamic')],
      undefined,
      { onRouteError: () => {} },
    )
    expect(dynamic['GET:/api/v1/items']!.unavailableReason).toContain('dynamic')
    expect(dynamic['GET:/api/v1/items']).toMatchObject({
      statusKnowledge: 'unknown',
      mediaType: 'application/json',
      mediaTypeKnowledge: 'known',
    })
  })
})

function contract(overrides: Partial<BackendResponseContract> = {}): BackendResponseContract {
  return {
    method: 'GET',
    routeTemplate: '/api/v1/items',
    source: 'test',
    hash: 'test',
    schema: { root: { type: 'string' }, definitions: {} },
    ...overrides,
  }
}
