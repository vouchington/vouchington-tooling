import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const sink:any;declare const raw:unknown;
 type Http=Response & {readonly apiHttpResponseVariants?:
 {status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}|{status:202;bodyKind:'none'}};
 declare const original:Http;declare function apiOpenApiHttpResponse<T>(key:string,value:T):T;
 declare function opaque(callback:()=>void):void;function ignore(callback:()=>void){};
 function invoke(callback:()=>void){callback()};`
const dispatch = `ctx.setStatus(response.status);
 if(!response.body)ctx.response.empty();else ctx.pipeline(response.body);`
const route = (body: string) => `${preamble}app.route('/rpc').post(async(ctx:any)=>{
 const response=apiOpenApiHttpResponse('POST:/rpc',original);${body}${dispatch}})`
const mutations = {
  body: '(response as any).body=raw;',
  status: '(response as any).status=201;',
  'body-alias': 'const reply=response as any;reply.body=raw;',
  'status-alias': 'const reply=response as any;reply.status=201;',
  'chained-alias': 'const reply=response;const copy=reply as any;copy.body=raw;',
  'literal-body': "(response as any)['body']=raw;",
  'literal-status': "(response as any)['status']=201;",
  'alias-literal': "const reply=response as any;reply['body']=raw;",
  'type-assertion': '(<any>response).body=raw;',
  nonnull: '(response! as any).body=raw;',
  await: '((await response) as any).body=raw;',
  'delete-body': 'delete(response as any).body;',
  'delete-status': 'const reply=response as any;delete reply.status;',
  'delete-literal': "delete(response as any)['body'];",
  'compound-body': '(response as any).body+=raw;',
  'compound-status': '(response as any).status+=1;',
  increment: '(response as any).status++;',
  decrement: '--(response as any).status;',
  nested: '(response.body as any).cancel=()=>{};',
  timer: 'setTimeout(()=>{(response as any).body=raw},1);',
  opaque: 'opaque(()=>{(response as any).status=201});',
  invoked: 'invoke(()=>{(response as any).body=raw});',
} as const
const controls = {
  readonly: '',
  alias: 'const reply=response;reply.status;',
  dead: 'if(false)(response as any).body=raw;',
  uncalled: 'function unused(){(response as any).status=201};',
  ignored: 'ignore(()=>{(response as any).body=raw});',
  foreign: 'sink.body=raw;',
  'foreign-delete': 'delete sink.status;',
  'foreign-update': 'sink.status++;',
  'unrelated-field': '(response as any).extra=raw;',
  'unrelated-delete': 'delete(response as any).extra;',
  'unrelated-update': '(response as any).extra++;',
  'unrelated-unary': '!(response as any).body;',
  'response-data': 'response.headers;',
} as const
const sources = Object.fromEntries(
  Object.entries({ ...mutations, ...controls }).map(([name, body]) => [name, route(body)]),
)
let matrix: VirtualProgramMatrix<string>
function discover(name: string, keys?: readonly string[], lenient = false) {
  const errors: string[] = []
  const rows = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    keys && new Set(keys),
    lenient ? { onRouteError: (error) => errors.push(error.reason) } : undefined,
  )
  return { rows, errors }
}
describe('branded HTTP body and status fields remain unchanged before dispatch', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(Object.keys(mutations))('rejects feasible branded response mutation %s', (name) => {
    for (const keys of [
      undefined,
      ['POST:/rpc#protocol-2'],
      ['POST:/rpc', 'POST:/rpc#protocol-2'],
    ]) {
      expect(() => discover(name, keys)).toThrow('branded response body or status is mutated')
      const { rows, errors } = discover(name, keys, true)
      for (const key of keys ?? ['POST:/rpc', 'POST:/rpc#protocol-2'])
        expect(rows[key]?.unavailableReason).toBeTruthy()
      expect(errors.some((reason) => reason.includes('body or status is mutated'))).toBe(true)
      if (keys) expect(Object.keys(rows)).toEqual(keys)
    }
  })
  it.each(Object.keys(controls))('preserves supported dispatch for %s', (name) => {
    for (const keys of [undefined, ['POST:/rpc#protocol-2']])
      for (const lenient of [false, true]) {
        const { rows, errors } = discover(name, keys, lenient)
        expect(Object.keys(rows)).toEqual(keys ?? ['POST:/rpc', 'POST:/rpc#protocol-2'])
        expect(Object.values(rows).every((row) => !row.unavailableReason)).toBe(true)
        expect(errors).toEqual([])
      }
  })
})
