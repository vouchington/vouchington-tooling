import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const sink:any;declare const raw:unknown;
  type Http=Response & {readonly apiHttpResponseVariants?:
    {status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}|{status:202;bodyKind:'none'}};
  declare const original:Http;
  declare function apiOpenApiHttpResponse<T>(key:string,response:T):T;
  declare function apiResponse<T>(key:string,body:T):T;
  function ignore(callback:()=>void){};function invoke(callback:()=>void){callback()}`
const dispatch = `const response=apiOpenApiHttpResponse('POST:/rpc',original);
  ctx.setStatus(response.status);if(!response.body)ctx.response.empty();else ctx.pipeline(response.body);`
const route = (body: string) => `${preamble}app.route('/rpc').post((ctx:any)=>{${body}})`
const invalid = {
  pipeline: route(`${dispatch}Reflect.apply(ctx.pipeline,ctx,[raw])`),
  'pipeline-before': route(`Reflect.apply(ctx.pipeline,ctx,[raw]);${dispatch}`),
  buffer: route(`${dispatch}Reflect.apply(ctx.response.buffer,ctx.response,[raw])`),
  empty: route(`${dispatch}Reflect.apply(ctx.response.empty,ctx.response,[])`),
  status: route(`${dispatch}Reflect.apply(ctx.setStatus,ctx,[201])`),
  'borrowed-pipeline': route(`${dispatch}Reflect.apply(sink.pipeline,ctx,[raw])`),
  'borrowed-buffer': route(`${dispatch}Reflect.apply(sink.buffer,ctx.response,[raw])`),
  'aliased-buffer': route(
    `${dispatch}const emit=ctx.response.buffer;Reflect.apply(emit,ctx.response,[raw])`,
  ),
  'borrowed-aliased-target': route(
    `${dispatch}const emit=sink.pipeline;Reflect.apply(emit,ctx,[raw])`,
  ),
  'aliased-target': route(`${dispatch}const emit=ctx.pipeline;Reflect.apply(emit,ctx,[raw])`),
  'aliased-standard': route(
    `${dispatch}const reflect=Reflect.apply;reflect(ctx.pipeline,ctx,[raw])`,
  ),
  'literal-brackets': route(`${dispatch}Reflect['apply'](ctx['pipeline'],ctx,[raw])`),
  'called-callback': route(`${dispatch}invoke(()=>Reflect.apply(ctx.pipeline,ctx,[raw]))`),
  'unknown-payload': route(`${dispatch}Reflect.apply(ctx.pipeline,ctx,sink.arguments)`),
} as const
const valid = {
  direct: route(dispatch),
  'other-receiver': route(`${dispatch}Reflect.apply(sink.pipeline,sink,[raw])`),
  'nonresponse-function': route(`${dispatch}Reflect.apply(()=>{},ctx,[])`),
  'other-standard-apply': route(`${dispatch}Function.apply(null,[])`),
  'typed-project-expression': route(
    `${dispatch}((()=>undefined as never) as typeof Reflect.apply)(ctx.pipeline,ctx,[raw])`,
  ),
  'typed-project-function':
    route(`${dispatch}const invoke:typeof Reflect.apply=()=>undefined as never;
    invoke(ctx.pipeline,ctx,[raw])`),
  'typed-project-method':
    route(`${dispatch}const invoke:{apply:typeof Reflect.apply}={apply:()=>undefined as never};
    invoke.apply(ctx.pipeline,ctx,[raw])`),
  'nonresponse-target': route(`${dispatch}Reflect.apply(sink.run,ctx.params,[raw])`),
  'context-data-method': route(`${dispatch}Reflect.apply(ctx.query.run,ctx.query,[raw])`),
  dead: route(`${dispatch}if(false)Reflect.apply(ctx.pipeline,ctx,[raw])`),
  ignored: route(`${dispatch}ignore(()=>Reflect.apply(ctx.pipeline,ctx,[raw]))`),
  uncalled: route(`${dispatch}function unused(){Reflect.apply(ctx.pipeline,ctx,[raw])}`),
  'shadowed-reflect':
    route(`${dispatch}const Reflect={apply(_target:unknown,_this:unknown,_args:unknown[]){}};
    Reflect.apply(ctx.pipeline,ctx,[raw])`),
  'project-reflect': `${preamble}declare const Reflect:{apply(target:unknown,receiver:unknown,args:unknown[]):void};
    app.route('/rpc').post((ctx:any)=>{${dispatch}Reflect.apply(ctx.pipeline,ctx,[raw])})`,
} as const
const ordinary = {
  'ordinary-pipeline': route(
    `Reflect.apply(ctx.pipeline,ctx,[raw]);ctx.json(apiResponse('POST:/rpc',{ok:true}))`,
  ),
  'ordinary-buffer': route(
    `Reflect.apply(ctx.response.buffer,ctx.response,[raw]);ctx.json(apiResponse('POST:/rpc',{ok:true}))`,
  ),
  'ordinary-borrowed': route(
    `Reflect.apply(sink.pipeline,ctx,[raw]);ctx.json(apiResponse('POST:/rpc',{ok:true}))`,
  ),
} as const
const sources = { ...invalid, ...valid, ...ordinary }
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
function discover(name: keyof typeof sources, keys?: readonly string[], lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    keys && new Set(keys),
    lenient ? { onRouteError: () => {} } : undefined,
  )
}
it.each(Object.keys(invalid) as (keyof typeof invalid)[])(
  'rejects unrepresented Reflect.apply %s',
  (name) => {
    for (const keys of [
      undefined,
      ['POST:/rpc#protocol-2'],
      ['POST:/rpc', 'POST:/rpc#protocol-2'],
    ]) {
      expect(() => discover(name, keys)).toThrow()
      const rows = discover(name, keys, true)
      if (keys) expect(Object.keys(rows)).toEqual(keys)
      for (const key of keys ?? ['POST:/rpc', 'POST:/rpc#protocol-2'])
        expect(rows[key]?.unavailableReason).toBeTruthy()
    }
  },
)
it.each(Object.keys(valid) as (keyof typeof valid)[])('preserves supported dispatch %s', (name) => {
  for (const lenient of [false, true]) {
    const rows = discover(name, undefined, lenient)
    expect(Object.keys(rows)).toEqual(['POST:/rpc', 'POST:/rpc#protocol-2'])
    expect(Object.values(rows).every((row) => !row.unavailableReason)).toBe(true)
  }
})
it.each(Object.keys(ordinary) as (keyof typeof ordinary)[])(
  'retains ordinary unavailable evidence %s',
  (name) => {
    for (const lenient of [false, true])
      expect(
        Object.values(discover(name, undefined, lenient)).some((row) => !!row.unavailableReason),
      ).toBe(true)
  },
)
