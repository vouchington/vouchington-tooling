import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const sink:any;
 type Http=Response & {readonly apiHttpResponseVariants?:
 {status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}|{status:202;bodyKind:'none'}};
 declare const original:Http;declare function apiOpenApiHttpResponse<T>(key:string,value:T):T;
 declare function apiResponse<T>(key:string,value:T):T;
 declare function emit(context:unknown):void;declare const unknownEmitter:any;
 declare function opaque(callback:()=>void):void;
 function ignore(callback:()=>void){};
 function inspect(value:any){return value.params};
 function consume(ctx:any,callback:(value:any)=>void){callback(ctx)};`
const dispatch = `const response=apiOpenApiHttpResponse('POST:/rpc',original);
 ctx.setStatus(response.status);if(!response.body)ctx.response.empty();else ctx.pipeline(response.body);`
const route = (body: string) => `${preamble}app.route('/rpc').post((ctx:any)=>{${body}})`
const escapes = {
  'global-reflect': 'globalThis.Reflect.apply(ctx.pipeline,ctx,[sink.raw]);',
  'nested-reflect-target': 'Reflect.apply(ctx.query.pipeline,ctx,[sink.raw]);',
  'reflected-this-target':
    'function reflected(this:any,value:unknown){this.pipeline(value)};Reflect.apply(reflected,ctx,[sink.raw]);',
  direct: 'emit(ctx);',
  alias: 'const context=ctx;emit(context);',
  cast: 'emit(ctx as unknown);',
  response: 'emit(ctx.response);',
  'response-alias': 'const responseTransport=ctx.response;emit(responseTransport);',
  any: 'unknownEmitter(ctx);',
  'unknown-method': 'sink.emit(ctx);',
  'borrowed-unknown': 'sink.call(ctx);',
  timer: 'setTimeout(()=>emit(ctx),1);',
  opaque: 'opaque(()=>emit(ctx));',
  invoked: 'consume(ctx,value=>emit(value));',
  forwarded: 'consume(ctx,emit);',
} as const
const controls = {
  direct: '',
  foreign: 'emit(sink);',
  'foreign-response': 'emit(sink.response);',
  'context-data': 'emit(ctx.params);',
  dead: 'if(false)emit(ctx);',
  uncalled: 'function unused(){emit(ctx)};',
  ignored: 'ignore(()=>emit(ctx));',
  inspect: 'inspect(ctx);',
  'mixed-inspector': 'inspect(ctx);inspect(sink);',
  'second-inspector': 'function second(other:any,value:any){return value.params};second(null,ctx);',
  'inspect-response': 'inspect(ctx.response);',
  'inspect-alias': 'const inspectAlias=inspect;inspectAlias(ctx);',
  consumed: 'consume(ctx,value=>value.params);',
  'consumed-named': 'consume(ctx,inspect);',
  'consumed-alias': 'const callback=inspect;consume(ctx,callback);',
  'consumed-ignore': 'consume(ctx,value=>ignore(()=>emit(value)));',
} as const
const sources = {
  ...Object.fromEntries(
    Object.entries(escapes).map(([key, body]) => [key, route(body + dispatch)]),
  ),
  ...Object.fromEntries(
    Object.entries(controls).map(([key, body]) => ['valid-' + key, route(body + dispatch)]),
  ),
  bodyless: route(dispatch + 'if(!response.body)emit(ctx);'),
  caller: `${preamble}function send(ctx:any){${dispatch}}
    app.route('/rpc').post((ctx:any)=>{send(ctx);emit(ctx)})`,
  'mixed-helper': route(
    `function forward(value:any){emit(value)}forward(ctx);forward(sink);${dispatch}`,
  ),
  'second-argument': route(
    `function forward(other:any,value:any){emit(value)}forward(null,ctx);${dispatch}`,
  ),
  'project-declared-reflect': `${preamble}declare const Reflect:{apply(target:unknown,receiver:unknown,args:unknown[]):void};
    app.route('/rpc').post((ctx:any)=>{${dispatch}Reflect.apply(ctx.pipeline,ctx,[])})`,
  cyclic: route(
    `function forward(value:any){if(value.again)forward(value);emit(value)}forward(ctx);${dispatch}`,
  ),
  'destructured-forward': route(
    `function forward({response}:any){emit(response)}forward(ctx);${dispatch}`,
  ),
  'indirect-consumer': route(
    `function forward(value:any,callback:(arg:any)=>void){callback(value)}
    function relay(ctx:any,callee:any){callee(ctx,emit)}relay(ctx,forward);${dispatch}`,
  ),
  'ordinary-context': route(`emit(ctx);ctx.json(apiResponse('POST:/rpc',{ok:true}));`),
  'ordinary-alias': route(
    `const transport=ctx.response;emit(transport);ctx.json(apiResponse('POST:/rpc',{ok:true}));`,
  ),
  'ordinary-timer': route(
    `setTimeout(()=>emit(ctx),1);ctx.json(apiResponse('POST:/rpc',{ok:true}));`,
  ),
  'ordinary-opaque': route(`opaque(()=>emit(ctx));ctx.json(apiResponse('POST:/rpc',{ok:true}));`),
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
describe('HTTP contexts cannot escape to opaque argument consumers', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each([
    ...Object.keys(escapes),
    'bodyless',
    'caller',
    'mixed-helper',
    'second-argument',
    'project-declared-reflect',
    'cyclic',
    'destructured-forward',
    'indirect-consumer',
  ])('rejects opaque canonical context argument %s', (name) => {
    for (const keys of [
      undefined,
      ['POST:/rpc#protocol-2'],
      ['POST:/rpc', 'POST:/rpc#protocol-2'],
    ]) {
      expect(() => discover(name, keys)).toThrow('context escapes through an opaque argument')
      const { rows, errors } = discover(name, keys, true)
      for (const key of keys ?? ['POST:/rpc', 'POST:/rpc#protocol-2'])
        expect(rows[key]?.unavailableReason).toBeTruthy()
      expect(errors.some((reason) => reason.includes('opaque argument'))).toBe(true)
      if (keys) expect(Object.keys(rows)).toEqual(keys)
    }
  })
  it.each(Object.keys(controls))('preserves proven or unrelated context argument %s', (name) => {
    for (const keys of [undefined, ['POST:/rpc#protocol-2']])
      for (const lenient of [false, true]) {
        const { rows, errors } = discover('valid-' + name, keys, lenient)
        expect(Object.keys(rows)).toEqual(keys ?? ['POST:/rpc', 'POST:/rpc#protocol-2'])
        expect(Object.values(rows).every((row) => !row.unavailableReason)).toBe(true)
        expect(errors).toEqual([])
      }
  })
  it.each(['ordinary-context', 'ordinary-alias', 'ordinary-timer', 'ordinary-opaque'])(
    'keeps ordinary emission evidence unavailable for %s',
    (name) => {
      for (const keys of [undefined, ['POST:/rpc']])
        for (const lenient of [false, true])
          expect(discover(name, keys, lenient).rows['POST:/rpc']?.unavailableReason).toBeTruthy()
    },
  )
})
