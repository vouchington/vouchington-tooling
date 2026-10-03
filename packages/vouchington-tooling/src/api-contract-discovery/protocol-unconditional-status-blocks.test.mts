import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const stream:{write(value:string):void};
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  type Http<T>=Response & {readonly apiHttpResponseVariants?:T};
  declare function apiOpenApiHttpResponse<K extends string,T>(key:K,response:Http<T>):Http<T>;
  declare const json:Http<{status:201;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}>;
  declare const second:typeof json;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const route = (body: string) => `${preamble}app.route('/events').get((ctx:any)=>{${body}})`
const sources = {
  sse: route(`{ctx.setStatus(201)};${frame}`),
  nested: route(`{{ctx.setStatus(202)}};${frame}`),
  overwrite: route(`ctx.setStatus(200);{ctx.setStatus(201)};${frame}`),
  'inner-overwrite': route(`{ctx.setStatus(200);ctx.setStatus(201)};${frame}`),
  'block-tail': route(`{ctx.setStatus(201);const value=1};${frame}`),
  'empty-block': route(`{};${frame}`),
  'unrelated-statements': route(`'ignored';Math.random();${frame}`),
  'after-frame': route(`${frame};{ctx.setStatus(201)}`),
  conditional: route(`{if(ctx.query.status)ctx.setStatus(201)};${frame}`),
  http: route(
    `const response=apiOpenApiHttpResponse('GET:/events',json);{ctx.setStatus(response.status)};ctx.pipeline(response.body)`,
  ),
  'http-nested': route(
    `const response=apiOpenApiHttpResponse('GET:/events',json);{{ctx.setStatus(response.status)}};ctx.pipeline(response.body)`,
  ),
  'http-conditional': route(
    `const response=apiOpenApiHttpResponse('GET:/events',json);{if(ctx.query.status)ctx.setStatus(response.status)};ctx.pipeline(response.body)`,
  ),
  'http-after-body': route(
    `const response=apiOpenApiHttpResponse('GET:/events',json);ctx.pipeline(response.body);{ctx.setStatus(response.status)}`,
  ),
  'http-foreign-overwrite': route(
    `const response=apiOpenApiHttpResponse('GET:/events',json);const other=apiOpenApiHttpResponse('GET:/events#other',second);ctx.setStatus(response.status);{ctx.setStatus(other.status)};ctx.pipeline(response.body);ctx.pipeline(other.body)`,
  ),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const discover = (name: keyof typeof sources, lenient = false) =>
  discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
it.each([
  ['sse', [201]],
  ['nested', [202]],
  ['overwrite', [201]],
  ['inner-overwrite', [201]],
  ['block-tail', [201]],
  ['empty-block', [200]],
  ['unrelated-statements', [200]],
  ['after-frame', [200]],
  ['http', [201]],
  ['http-nested', [201]],
] as const)('uses the last unconditional setter in %s', (name, statuses) => {
  expect(Object.values(discover(name)).map(responseStatusCodesForContract)).toEqual([statuses])
})
it.each(['conditional', 'http-conditional', 'http-foreign-overwrite', 'http-after-body'] as const)(
  'rejects unproven %s',
  (name) => {
    expect(() => discover(name)).toThrow()
    expect(Object.values(discover(name, true)).every((row) => row.unavailableReason)).toBe(true)
  },
)
