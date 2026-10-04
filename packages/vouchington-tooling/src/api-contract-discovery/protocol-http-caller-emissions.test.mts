import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import ts from '../contract-schema/typescript-api.mts'
import { httpContextScopes } from './protocol-http-context.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const sink:any;declare const raw:unknown;
  type Http=Response & {readonly apiHttpResponseVariants?:
    {status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}|{status:202;bodyKind:'none'}};
  declare const original:Http;
  declare function apiOpenApiHttpResponse<T>(key:string,response:T):T;
  declare function apiResponse<T>(key:string,body:T):T;
  declare function opaque(callback:()=>void):void;
  function ignore(callback:()=>void){}
  function invoke(callback:()=>void){callback()}`
const dispatch = `const response=apiOpenApiHttpResponse('POST:/rpc',original);
  ctx.setStatus(response.status);if(!response.body)ctx.response.empty();else ctx.pipeline(response.body);`
const route = (body: string) => `${preamble}app.route('/rpc').post((ctx:any)=>{${body}})`
const helper = (body: string) => `${preamble}function send(ctx:any){${dispatch}}
  app.route('/rpc').post((ctx:any)=>{${body}})`
const invalid = {
  'caller-before': helper('ctx.pipeline(raw);send(ctx)'),
  'caller-after': helper('send(ctx);ctx.pipeline(raw)'),
  'caller-json': helper('send(ctx);ctx.json(raw)'),
  'caller-buffer': helper('send(ctx);ctx.response.buffer(raw)'),
  'caller-timer': helper('send(ctx);setTimeout(()=>ctx.pipeline(raw),1)'),
  'caller-invoked': helper('send(ctx);invoke(()=>ctx.pipeline(raw))'),
  'forwarded-caller': route(`function send(ctx:any){${dispatch}}
    function relay(ctx:any){ctx.pipeline(raw);send(ctx)}relay(ctx)`),
  call: route(`${dispatch}ctx.pipeline.call(ctx,raw)`),
  apply: route(`${dispatch}ctx.pipeline.apply(ctx,[raw])`),
  bind: route(`${dispatch}const emit=ctx.pipeline.bind(ctx);emit(raw)`),
  'method-alias': route(`${dispatch}const emit=ctx.pipeline;emit.call(ctx,raw)`),
  'nested-indirect': route(`${dispatch}ctx.pipeline.bind.call(ctx.pipeline,ctx)(raw)`),
  'bracket-call': route(`${dispatch}ctx['pipeline']['call'](ctx,raw)`),
  'response-buffer': route(`${dispatch}ctx.response.buffer.call(ctx.response,raw)`),
  'response-method-alias': route(
    `${dispatch}const emit=ctx.response.buffer;emit.call(ctx.response,raw)`,
  ),
  'response-empty': route(`${dispatch}ctx.response.empty.apply(ctx.response,[])`),
  'status-call': route(`${dispatch}ctx.setStatus.call(ctx,201)`),
  'borrowed-call': route(`${dispatch}sink.pipeline.call(ctx,raw)`),
  'borrowed-buffer': route(`${dispatch}sink.buffer.call(ctx.response,raw)`),
  'helper-indirect-caller': helper('send(ctx);ctx.pipeline.call(ctx,raw)'),
  'opaque-indirect': route(`${dispatch}opaque(()=>ctx.pipeline.call(ctx,raw))`),
  'timer-indirect': route(`${dispatch}setTimeout(()=>ctx.pipeline.call(ctx,raw),1)`),
} as const
const valid = {
  direct: route(dispatch),
  helper: helper('send(ctx)'),
  'repeated-helper': helper('send(ctx);send(ctx)'),
  alias: helper('const context=ctx;send(context)'),
  'dead-caller': helper('send(ctx);if(false)ctx.pipeline(raw)'),
  'ignored-caller': helper('send(ctx);ignore(()=>ctx.pipeline(raw))'),
  'uncalled-caller': helper('send(ctx);function unused(){ctx.pipeline(raw)}'),
  'foreign-caller': helper('send(ctx);sink.pipeline(raw)'),
  'dead-indirect': route(`${dispatch}if(false)ctx.pipeline.call(ctx,raw)`),
  'ignored-indirect': route(`${dispatch}ignore(()=>ctx.pipeline.apply(ctx,[raw]))`),
  'uncalled-indirect': route(`${dispatch}function unused(){ctx.pipeline.call(ctx,raw)}`),
  'foreign-indirect': route(`${dispatch}sink.pipeline.call(sink,raw)`),
  'foreign-alias': route(`${dispatch}const emit=sink.pipeline;emit.call(sink,raw)`),
  'context-data-method': route(`${dispatch}ctx.query.run.call(ctx.query,raw)`),
  'unrecognized-borrowed': route(`${dispatch}sink.unrelated.call(ctx,raw)`),
  'unknown-borrowed': route(`${dispatch}sink.call(ctx,raw)`),
  'noncontext-this': route(`${dispatch}sink.pipeline.call(ctx.params,raw)`),
} as const
const ordinary = {
  'ordinary-call': route(`ctx.pipeline.call(ctx,raw);ctx.json(apiResponse('POST:/rpc',{ok:true}))`),
  'ordinary-apply': route(
    `ctx.pipeline.apply(ctx,[raw]);ctx.json(apiResponse('POST:/rpc',{ok:true}))`,
  ),
} as const
const sources = {
  ...invalid,
  ...valid,
  ...ordinary,
  'foreign-helper': helper('send(sink)'),
  'suffix-wrapper': helper(
    'send(ctx);const wrapper={ctx};setTimeout(()=>wrapper.ctx.pipeline(raw),1)',
  ),
}
let matrix: VirtualProgramMatrix<keyof typeof sources>
function discover(name: keyof typeof sources, keys?: readonly string[], lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    keys && new Set(keys),
    lenient ? { onRouteError: () => {} } : undefined,
  )
}
describe('HTTP contracts include actual caller emissions and indirect methods', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it('does not admit a context scope supplied by a foreign helper caller', () => {
    const send = matrix
      .sourceFile('foreign-helper')
      .statements.find(
        (node): node is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(node) && node.name?.text === 'send',
      )!
    expect(httpContextScopes(send, matrix.program.getTypeChecker()).size).toBe(0)
    expect(() => discover('foreign-helper')).toThrow('handler context')
  })
  it('preserves nested mutable-wrapper unavailability for every selected protocol row', () => {
    for (const keys of [undefined, ['POST:/rpc#protocol-2'], ['POST:/rpc', 'POST:/rpc#protocol-2']])
      for (const lenient of [false, true]) {
        const rows = discover('suffix-wrapper', keys, lenient)
        for (const key of keys ?? ['POST:/rpc', 'POST:/rpc#protocol-2'])
          expect(rows[key]?.unavailableReason).toBe(
            'route emits a response through a mutable context wrapper whose status or body is not statically determinable',
          )
      }
  })
  it.each(Object.keys(invalid) as (keyof typeof invalid)[])(
    'rejects unaccounted emission %s',
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
  it.each(Object.keys(valid) as (keyof typeof valid)[])(
    'preserves accounted response %s',
    (name) => {
      for (const keys of [undefined, ['POST:/rpc#protocol-2']])
        for (const lenient of [false, true]) {
          const rows = discover(name, keys, lenient)
          expect(Object.keys(rows)).toEqual(keys ?? ['POST:/rpc', 'POST:/rpc#protocol-2'])
          expect(Object.values(rows).every((row) => !row.unavailableReason)).toBe(true)
        }
    },
  )
  it.each(Object.keys(ordinary) as (keyof typeof ordinary)[])(
    'retains ordinary raw emission %s',
    (name) => {
      for (const lenient of [false, true])
        expect(
          Object.values(discover(name, undefined, lenient)).some((row) => !!row.unavailableReason),
        ).toBe(true)
    },
  )
})
