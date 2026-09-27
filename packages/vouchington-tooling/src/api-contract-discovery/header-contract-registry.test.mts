import { beforeAll, describe, expect, it } from 'vitest'

import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
import { discoverApiHeaderContracts } from './header-contract-registry.mts'

const preamble = `declare const app: any; declare function apiHeaders(key: string, value: unknown): void;`
const route = (body: string) => `${preamble} app.route('/items').get(() => { ${body} })`
const sources = {
  valid: `${route(`apiHeaders('GET:/items', { request: { 'x-token': { type: 'string' } } })`)}
    app.route('/alpha').get(() => apiHeaders('GET:/alpha', {}))`,
  malformed: route(`apiHeaders('GET:/items', null)`),
  outside: `${preamble} apiHeaders('GET:/items', {})`,
  mismatch: route(`apiHeaders('POST:/items', {})`),
  unknown: route(`apiHeaders('GET:/items', {})`),
  duplicate: route(`apiHeaders('GET:/items', {}); apiHeaders('GET:/items', {})`),
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>
const known = new Set(['GET:/items', 'GET:/alpha'])
function discover(id: keyof typeof sources, responseRoutes: ReadonlySet<string> = known) {
  return discoverApiHeaderContracts(matrix.program, [matrix.sourceFile(id)], responseRoutes)
}

describe('API header registry', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, 15_000)

  it('discovers a header contract inside a known route', () => {
    const result = discover('valid')
    expect(Object.keys(result)).toEqual(['GET:/alpha', 'GET:/items'])
    expect(result['GET:/items']?.requestHeaders['x-token']).toEqual({
      type: 'string',
      required: false,
    })
  })

  it.each([
    ['malformed', /literal operation key and object contract/],
    ['outside', /must be inside an app.route handler/],
    ['mismatch', /does not match enclosing route/],
    ['unknown', /unknown response route/],
    ['duplicate', /Duplicate apiHeaders marker/],
  ] as const)('rejects %s marker', (id, message) => {
    expect(() => discover(id, id === 'unknown' ? new Set() : known)).toThrow(message)
  })
})
