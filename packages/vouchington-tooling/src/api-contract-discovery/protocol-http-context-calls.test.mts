import { beforeAll, describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../openapi-document/index.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const sink:any;declare const raw:unknown;
  type Http=Response & {readonly apiHttpResponseVariants?:
    {status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}|{status:202;bodyKind:'none'}};
  declare const original:Http;
  declare function apiOpenApiHttpResponse<T>(key:string,response:T):T;
  declare function apiResponse<T>(key:string,body:T):T;
  function ignore(callback:()=>void){}`
const dispatch = `const response=apiOpenApiHttpResponse('POST:/rpc',original);
  ctx.setStatus(response.status);if(!response.body)ctx.response.empty();else ctx.pipeline(response.body);`
const route = (body: string) => `${preamble}app.route('/rpc').post((ctx:any)=>{${body}})`
const helper = (argument: string, thisParameter = false) => `${preamble}
  function send(${thisParameter ? 'this:void,' : ''}context:any){${dispatch.replaceAll('ctx.', 'context.')}}
  app.route('/rpc').post((ctx:any)=>{${argument}})`
const invalid = {
  'bracket-pipeline': route(`ctx['pipeline'](raw);${dispatch}`),
  'bracket-json': route(`ctx['json'](raw);${dispatch}`),
  'bracket-buffer': route(`ctx.response['buffer'](raw);${dispatch}`),
  'bracket-response-buffer': route(`ctx['response'].buffer(raw);${dispatch}`),
  'bracket-empty': route(`ctx.response['empty']();${dispatch}`),
  'bracket-status': route(`ctx['setStatus'](201);${dispatch}`),
  'foreign-helper': helper('send(sink)'),
  'foreign-this-helper': helper('send(sink)', true),
  'mixed-helper': helper('send(ctx);send(sink)'),
  'reassigned-handler': route(`ctx=sink;${dispatch}`),
  'reassigned-helper': `${preamble}function send(context:any){context=sink;${dispatch.replaceAll('ctx.', 'context.')}}
    app.route('/rpc').post((ctx:any)=>send(ctx))`,
  'mutable-helper-alias': helper('let alias=ctx;send(alias)'),
  'missing-helper-argument': `${preamble}function send(context:any=undefined){${dispatch.replaceAll('ctx.', 'context.')}}
    app.route('/rpc').post((ctx:any)=>send())`,
  'registered-and-foreign-call': `${preamble}function send(ctx:any){${dispatch}}
    app.route('/rpc').post(send);send(sink)`,
  'cycle-helper': route(
    `function send(ctx:any){if(ctx.query.again)send(ctx);${dispatch}}send(ctx)`,
  ),
} as const
const valid = {
  direct: route(dispatch),
  'literal-bracket-dispatch': route(
    dispatch
      .replaceAll('ctx.setStatus', "ctx['setStatus']")
      .replaceAll('ctx.pipeline', "ctx['pipeline']")
      .replaceAll('ctx.response.empty', "ctx.response['empty']"),
  ),
  'bracket-response-dispatch': route(
    dispatch.replaceAll('ctx.response.empty', "ctx['response'].empty"),
  ),
  'helper-context': helper('send(ctx)'),
  'helper-forwarded-context':
    route(`function send(context:any){${dispatch.replaceAll('ctx.', 'context.')}}
    function relay(context:any){send(context)}relay(ctx)`),
  'helper-const-alias': helper('const alias=ctx;send(alias)'),
  'helper-this-parameter': helper('send(ctx)', true),
  'helper-alias': route(`function send(context:any){${dispatch.replaceAll('ctx.', 'context.')}}
    const relay=send;relay(ctx)`),
  'dead-foreign-helper': helper('if(false)send(sink);send(ctx)'),
  'unrelated-bracket': route(`sink['pipeline'](raw);${dispatch}`),
  'dead-bracket': route(`if(false)ctx['pipeline'](raw);${dispatch}`),
  'ignored-bracket': route(`ignore(()=>ctx['pipeline'](raw));${dispatch}`),
} as const
const ordinary = {
  'ordinary-bracket-pipeline': route(
    `ctx['pipeline'](raw);ctx.json(apiResponse('POST:/rpc',{ok:true}))`,
  ),
  'ordinary-bracket-json': route(`ctx['json'](raw);ctx.json(apiResponse('POST:/rpc',{ok:true}))`),
  'ordinary-bracket-empty': route(
    `ctx.response['empty']();ctx.json(apiResponse('POST:/rpc',{ok:true}))`,
  ),
} as const
const sources = { ...invalid, ...valid, ...ordinary }
let matrix: VirtualProgramMatrix<keyof typeof sources>
function discover(name: keyof typeof sources, lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
}
function unavailable(rows: ReturnType<typeof discover>) {
  return buildOpenApiDocument({ title: 'Actual HTTP context', responseContracts: rows })[
    'x-unavailable-routes'
  ]
}
describe('HTTP methods bind the actual registered context', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(Object.keys(invalid) as (keyof typeof invalid)[])(
    'rejects invalid context %s',
    (name) => {
      expect(() => discover(name)).toThrow()
      expect(unavailable(discover(name, true))).toContain('POST:/rpc')
    },
  )
  it.each(Object.keys(valid) as (keyof typeof valid)[])('preserves actual dispatch %s', (name) => {
    for (const lenient of [false, true]) expect(unavailable(discover(name, lenient))).toEqual([])
  })
  it.each(Object.keys(ordinary) as (keyof typeof ordinary)[])(
    'retains raw ordinary bracket %s',
    (name) => {
      for (const lenient of [false, true])
        expect(unavailable(discover(name, lenient))).toEqual(['POST:/rpc'])
    },
  )
})
