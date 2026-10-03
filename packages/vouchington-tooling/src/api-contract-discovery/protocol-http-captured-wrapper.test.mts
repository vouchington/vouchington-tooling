import { beforeAll, describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../openapi-document/index.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  declare const raw:unknown;declare const other:any;
  type Http=Response & {readonly apiHttpResponseVariants?:
    {status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}};
  declare const original:Http;
  declare function apiOpenApiHttpResponse<T>(key:string,response:T):T;
  declare function apiResponse<T>(key:string,body:T):T;
  function invoke(callback:()=>void){callback()}
  function ignore(callback:()=>void){}`
const dispatch = `const response=apiOpenApiHttpResponse('POST:/rpc',original);
  ctx.setStatus(response.status);ctx.pipeline(response.body);`
const ordinary = `ctx.json(apiResponse('POST:/rpc',{ok:true}));`
const route = (body: string, branded: boolean) => `${preamble}
  app.route('/rpc').post((ctx:any)=>{const wrapper={ctx};${body};${branded ? dispatch : ordinary}})`
const emissions = {
  json: 'wrapper.ctx.json(raw)',
  pipeline: 'wrapper.ctx.pipeline(raw)',
  buffer: 'wrapper.ctx.response.buffer(raw)',
  empty: 'wrapper.ctx.response.empty()',
  status: 'wrapper.ctx.setStatus(201)',
  promise: 'new Promise<void>(resolve=>{wrapper.ctx.json(raw);resolve()})',
  helper: 'invoke(()=>wrapper.ctx.json(raw))',
  nested: 'setTimeout(()=>invoke(()=>wrapper.ctx.json(raw)),1)',
} as const
const controls = {
  'dead-body': 'setTimeout(()=>{if(false)wrapper.ctx.json(raw)},1)',
  'dead-timer': 'if(false)setTimeout(()=>wrapper.ctx.json(raw),1)',
  'unused-outer': 'function unused(){setTimeout(()=>wrapper.ctx.json(raw),1)}',
  'ignored-callback': 'ignore(()=>wrapper.ctx.json(raw))',
  'ignored-timer-parent': 'ignore(()=>setTimeout(()=>wrapper.ctx.json(raw),1))',
  'other-context': 'setTimeout(()=>{const wrapper={ctx:other};wrapper.ctx.json(raw)},1)',
  'shadowed-context': 'invoke(()=>{const ctx=other;const wrapper={ctx};wrapper.ctx.json(raw)})',
  'no-context-parameter': 'invoke(()=>{const wrapper={ctx:other};wrapper.ctx.json(raw)})',
  'nonresponse-property': 'setTimeout(()=>ctx.metrics.json(raw),1)',
  'deep-nonresponse-property': 'setTimeout(()=>ctx.metrics.output.json(raw),1)',
} as const
const sources = Object.fromEntries([
  ...Object.entries(emissions).flatMap(([name, body]) => {
    const callback = ['promise', 'helper', 'nested'].includes(name)
      ? body
      : `setTimeout(()=>${body},1)`
    return [
      [name, route(callback, true)],
      ['ordinary-' + name, route(callback, false)],
    ]
  }),
  ...Object.entries(controls).flatMap(([name, body]) => [
    [name, route(body, true)],
    ['ordinary-' + name, route(body, false)],
  ]),
  ...['json', 'empty', 'status'].map((name) => [
    'direct-' + name,
    route(emissions[name as 'json' | 'empty' | 'status'], false),
  ]),
])
let matrix: VirtualProgramMatrix<string>
function discover(name: string, lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
}
const reason =
  'route emits a response through a mutable context wrapper whose status or body is not statically determinable'

describe('captured HTTP context wrappers follow supported executable ancestors', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(Object.keys(emissions))('retains captured wrapper %s in both modes', (name) => {
    for (const key of [name, 'ordinary-' + name])
      for (const lenient of [false, true]) {
        const rows = discover(key, lenient)
        expect(
          buildOpenApiDocument({ title: 'Captured wrapper', responseContracts: rows })[
            'x-unavailable-routes'
          ],
        ).toEqual(['POST:/rpc'])
        expect(rows['POST:/rpc']?.unavailableReason).toBe(reason)
      }
  })
  it.each(Object.keys(controls))('preserves unrelated or unexecuted wrapper %s', (name) => {
    for (const key of [name, 'ordinary-' + name])
      for (const lenient of [false, true])
        expect(Object.values(discover(key, lenient)).every((row) => !row.unavailableReason)).toBe(
          true,
        )
  })
  it.each(['json', 'empty', 'status'])(
    'reports the specific direct mutable-wrapper reason for %s',
    (name) => {
      for (const lenient of [false, true])
        expect(discover('direct-' + name, lenient)['POST:/rpc']?.unavailableReason).toBe(reason)
    },
  )
})
