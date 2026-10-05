import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const other:any;
 type Http=Response & {readonly apiHttpResponseVariants?:
 {status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}|{status:202;bodyKind:'none'}};
 declare const original:Http;declare function apiOpenApiHttpResponse<T>(key:string,value:T):T;
 declare function opaque(callback:()=>void):void;function ignore(callback:()=>void){};`
const dispatch = `const response=apiOpenApiHttpResponse('POST:/rpc',original);
 ctx.setStatus(response.status);if(!response.body)ctx.response.empty();else ctx.pipeline(response.body);`
const route = (body: string) => `${preamble}app.route('/rpc').post((ctx:any)=>{${body}${dispatch}})`
const mutations = {
  pipeline: `const context=ctx;context.pipeline=()=>{};`,
  status: `const context=ctx;context.setStatus=()=>{};`,
  empty: `const transport=ctx.response;transport.empty=()=>{};`,
  buffer: `const transport=ctx.response;transport.buffer=()=>{};`,
  json: `const context=ctx;context.json=()=>{};`,
  response: `const context=ctx;context.response={};`,
  cast: `const context=ctx;(context as any).pipeline=()=>{};`,
  bracket: `const context=ctx;context['pipeline']=()=>{};`,
  'nested-bracket': `const context=ctx;context['response'].empty=()=>{};`,
  'delete-status': `const context=ctx;delete context.setStatus;`,
  'delete-empty': `const transport=ctx.response;delete transport.empty;`,
  'compound-write': `const context=ctx;context.pipeline+=1;`,
  increment: `const context=ctx;context.pipeline++;`,
  decrement: `const context=ctx;--context.pipeline;`,
  timer: `const context=ctx;setTimeout(()=>{context.pipeline=()=>{}},1);`,
  opaque: `const context=ctx;opaque(()=>{context.pipeline=()=>{}});`,
} as const
const direct = {
  'direct-pipeline': `ctx.pipeline=()=>{};`,
  'direct-status': `ctx.setStatus=()=>{};`,
  'direct-empty': `ctx.response.empty=()=>{};`,
} as const
const controls = {
  dispatch: '',
  'const-alias': `const context=ctx;context.params;`,
  dead: `const context=ctx;if(false)context.pipeline=()=>{};`,
  uncalled: `const context=ctx;function unused(){context.pipeline=()=>{}};`,
  ignored: `const context=ctx;ignore(()=>{context.pipeline=()=>{}});`,
  foreign: `other.pipeline=()=>{};`,
  'foreign-delete': `delete other.empty;`,
  'unrelated-field': `const context=ctx;context.params={};`,
  'unrelated-update': `const context=ctx;context.count++;`,
  'unrelated-unary': `const context=ctx;!context.pipeline;`,
  'known-helper': `function inspect(value:any){return value.params};inspect(ctx);`,
} as const
const sources = {
  ...Object.fromEntries(
    Object.entries({ ...mutations, ...direct, ...controls }).map(([name, body]) => [
      name,
      route(body),
    ]),
  ),
  caller: `${preamble}function send(ctx:any){${dispatch}}app.route('/rpc').post((ctx:any)=>{const context=ctx;context.pipeline=()=>{};send(ctx)})`,
}
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
describe('HTTP response methods remain unchanged before branded dispatch', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each([...Object.keys(mutations), 'caller'])(
    'rejects feasible canonical method mutation %s',
    (name) => {
      for (const keys of [
        undefined,
        ['POST:/rpc#protocol-2'],
        ['POST:/rpc', 'POST:/rpc#protocol-2'],
      ]) {
        const reason = ['timer', 'opaque'].includes(name)
          ? 'opaque argument'
          : 'context method is mutated'
        expect(() => discover(name, keys)).toThrow(reason)
        const { rows, errors } = discover(name, keys, true)
        for (const key of keys ?? ['POST:/rpc', 'POST:/rpc#protocol-2'])
          expect(rows[key]?.unavailableReason).toBeTruthy()
        expect(errors.some((error) => error.includes(reason))).toBe(true)
        if (keys) expect(Object.keys(rows)).toEqual(keys)
      }
    },
  )
  it.each(Object.keys(direct))('retains existing direct-write rejection for %s', (name) => {
    expect(() => discover(name)).toThrow('handler context')
    expect(
      Object.values(discover(name, undefined, true).rows).every((row) => !!row.unavailableReason),
    ).toBe(true)
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
