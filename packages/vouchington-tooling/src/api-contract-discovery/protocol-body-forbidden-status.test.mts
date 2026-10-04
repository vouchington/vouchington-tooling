import { beforeAll, describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../openapi-document/index.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const other:any;
  declare const stream:{write(value:string):void};
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  type Http<T>=Response & {readonly apiHttpResponseVariants?:T};
  type Content<S extends number>={status:S;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}};
  type Empty<S extends number>={status:S;bodyKind:'none'};
  declare function apiOpenApiHttpResponse<K extends string,T>(key:K,response:Http<T>):Http<T>;`
const http = (status: number, empty = false) => `${preamble}
  declare const raw:Http<${empty ? 'Empty' : 'Content'}<${status}>>;
  app.route('/http').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/http#typed',raw);
    ctx.setStatus(response.status);${empty ? 'if(!response.body)ctx.response.empty()' : 'ctx.pipeline(response.body)'}})`
const sse = (status: string) => `${preamble}app.route('/events').get((ctx:any)=>{${status}
  stream.write(apiSseFrame('GET:/events#typed',{event:'done' as const,data:{ok:true}}))})`
const forbidden = [100, 101, 103, 199, 204, 205, 304] as const
const allowed = [200, 201, 202, 206, 300, 301, 302, 303, 305, 307, 308, 400, 599] as const
const sources = Object.fromEntries([
  ...[...forbidden, ...allowed].flatMap((status) => [
    [`http-${status}`, http(status)],
    [`sse-${status}`, sse(`ctx.setStatus(${status});`)],
  ]),
  ...forbidden.map((status) => [`empty-${status}`, http(status, true)]),
  ['sse-mixed', sse('ctx.setStatus(Math.random()?200:304);')],
  ['sse-default', sse('')],
  ['sse-dead', sse('if(false)ctx.setStatus(304);')],
  ['sse-other', sse('other.setStatus(304);')],
  [
    'http-mixed',
    `${preamble}declare const raw:Http<Content<200>|Content<304>|Empty<202>>;
    app.route('/http').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/http',raw);
      ctx.setStatus(response.status);if(!response.body)ctx.response.empty();else ctx.pipeline(response.body)})`,
  ],
])
let matrix: VirtualProgramMatrix<string>
function discover(name: string, keys?: readonly string[], lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    keys && new Set(keys),
    lenient ? { onRouteError: () => {} } : undefined,
  )
}
describe('protocol content respects HTTP statuses that forbid a body', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(forbidden)('rejects content at status %i in HTTP and SSE', (status) => {
    for (const protocol of ['http', 'sse']) {
      const key = protocol === 'http' ? 'POST:/http#typed' : 'GET:/events#typed'
      for (const keys of [undefined, [key]]) {
        expect(() => discover(`${protocol}-${status}`, keys)).toThrow('forbids response content')
        const rows = discover(`${protocol}-${status}`, keys, true)
        if (keys) expect(Object.keys(rows)).toEqual([key])
        else expect(Object.keys(rows)).toContain(key)
        expect(rows[key]?.unavailableReason).toContain('forbids response content')
      }
    }
  })
  it.each(allowed)('preserves content at permitted status %i', (status) => {
    for (const protocol of ['http', 'sse'])
      for (const lenient of [false, true]) {
        const rows = Object.values(discover(`${protocol}-${status}`, undefined, lenient))
        expect(rows.every((row) => !row.unavailableReason)).toBe(true)
        expect(rows.map(responseStatusCodesForContract)).toEqual([[status]])
      }
  })
  it.each(forbidden)('preserves an explicitly bodyless status %i', (status) => {
    const rows = discover(`empty-${status}`)
    expect(Object.values(rows).map((row) => row.bodyKind)).toEqual(['none'])
    const doc = buildOpenApiDocument({ title: 'Bodyless protocol', responseContracts: rows })
    expect(doc['x-unavailable-routes']).toEqual([])
    expect(doc.paths['/http']!.post!.responses[status]).not.toHaveProperty('content')
  })
  it('rejects a mixed SSE status union containing a body-forbidden response', () => {
    expect(() => discover('sse-mixed')).toThrow('forbids response content')
    expect(
      Object.values(discover('sse-mixed', undefined, true)).every((row) => !!row.unavailableReason),
    ).toBe(true)
  })
  it.each(['sse-default', 'sse-dead', 'sse-other'])('preserves default status in %s', (name) => {
    const rows = Object.values(discover(name))
    expect(rows.every((row) => !row.unavailableReason)).toBe(true)
    expect(rows.map(responseStatusCodesForContract)).toEqual([[200]])
  })
  it('validates the exact selected HTTP variant and preserves excluded row selection', () => {
    expect(() => discover('http-mixed', ['POST:/http#protocol-2'])).toThrow(
      'forbids response content',
    )
    expect(
      discover('http-mixed', ['POST:/http#protocol-2'], true)['POST:/http#protocol-2']
        ?.unavailableReason,
    ).toContain('forbids response content')
    const rows = discover('http-mixed', ['POST:/http'])
    expect(Object.keys(rows)).toEqual(['POST:/http'])
    expect(rows['POST:/http']?.unavailableReason).toBeUndefined()
  })
})
