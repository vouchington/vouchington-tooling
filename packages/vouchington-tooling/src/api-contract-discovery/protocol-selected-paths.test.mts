import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  type Http<T>=Response & {readonly apiHttpResponseVariants?:T};
  declare function apiOpenApiHttpResponse<K extends string,T>(key:K,value:Http<T>):Http<T>;
  type Good={status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}};
  type Bad={status:number;bodyKind:'none'};
  declare const value:Http<Good|Bad>;`
const sources = {
  'context-free-handler': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    function handler(){stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}))}app.route('/events').get(handler)`,
  'missing-carrier': `declare const app:any;declare function apiOpenApiHttpResponse<K extends string,T>(key:K,value:T):T;declare const value:Response;
    app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',value);ctx.setStatus(response.status);ctx.pipeline(response.body)})`,
  'custom-promise': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    class Promise{constructor(executor:()=>void){}}app.route('/events').get((ctx:any)=>new Promise(()=>stream.write(apiSseFrame('GET:/events',{event:'never',data:{ok:true}}))))`,
  'timer-frame': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    app.route('/events').get((ctx:any)=>setInterval(async()=>stream.write(apiSseFrame('GET:/events',{event:'stats',data:{ok:true}})),2000))`,
  'promise-timer-helper': `declare const app:any;class Stream{write(frame:string):void{}}const stream=new Stream();declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    function pipe(options:{emit:()=>void}){const {emit}=options;return new Promise<void>(resolve=>{function flush(){emit()}setInterval(flush,2000)})}
    app.route('/events').get((ctx:any)=>pipe({emit:()=>stream.write(apiSseFrame('GET:/events',{event:'progress',data:{ok:true}}))}))`,
  'promise-created': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    app.route('/events').get((ctx:any)=>{ctx.setStatus(201);return new Promise<void>(resolve=>{stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}));resolve()})})`,
  'erased-this-callback': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    function invoke(this:void,first:()=>void,second:()=>void){first()}
    app.route('/events').get((ctx:any)=>invoke(()=>{},()=>stream.write(apiSseFrame('GET:/events',{event:'never',data:{ok:true}}))))`,
  'erased-this-handler': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    function handler(this:void,ctx:any){ctx.setStatus(201);stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}))};app.route('/events').get(handler)`,
  'erased-this-http': `${preamble}declare const several:Http<Good>;function handler(this:void,ctx:any){const response=apiOpenApiHttpResponse('POST:/rpc',several);ctx.setStatus(response.status);ctx.pipeline(response.body)}app.route('/rpc').post(handler)`,
  'uninitialized-local': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    app.route('/events').get((ctx:any)=>{let unused:any;stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}))})`,
  'private-pipeline': `${preamble}declare const several:Http<Good>;app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',several);ctx.setStatus(response.status);ctx.pipeline(response.body);ctx.internal.pipeline('private')})`,
  'rewritten-named-sse': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    function handler(ctx:any){stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}))}
    // @ts-expect-error runtime reassignment is deliberately unsupported
    handler=()=>{};app.route('/events').get(handler)`,
  'named-sse': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    const handler=(ctx:any)=>{ctx.setStatus(201);stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}))};app.route('/events').get(handler)`,
  'deferred-named-sse': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    function emit(ctx:any){stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}))}app.route('/events').get((ctx:any)=>{function ignored(){emit(ctx)}})`,
  'const-context': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    app.route('/events').get((ctx:any)=>{const output=ctx;output.setStatus(201);stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}))})`,
  'mutable-context': `declare const app:any;declare const stream:{write(frame:string):void};declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    app.route('/events').get((ctx:any)=>{let output=ctx;output.setStatus(201);stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}))})`,
  'unused-sse': `declare const app:any; declare const stream:{write(frame:string):void};
    declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;
    app.route('/events').get((ctx:any)=>{stream.write(apiSseFrame('GET:/events',{event:'ok',data:{ok:true}}));
    const unused=apiSseFrame('GET:/events',{event:'unused',data:{unused:true}})})`,
  variants: `${preamble} app.route('/rpc').post((ctx:any)=>{
    const response=apiOpenApiHttpResponse('POST:/rpc',value);ctx.setStatus(response.status);
    if(!response.body)ctx.response.empty();else ctx.pipeline(response.body)
  })`,
  'bodyless-extra-media': `${preamble}declare const several:Http<{status:202;bodyKind:'none';mediaType:'application/json'|'application/problem+json'}>;
    app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',several);ctx.setStatus(response.status);if(!response.body)ctx.response.empty()})`,
  unrelated: `${preamble} declare const several:Http<{status:200;bodyKind:'content';mediaType:'application/json'|'application/problem+json';body:{ok:boolean}}>;
    app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',several);
    ctx.pipeline(response.body)})`,
  media: `${preamble} declare const several:Http<{status:200;bodyKind:'content';mediaType:'application/json'|'application/problem+json';body:{ok:boolean}}>;
    app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',several);
    ctx.setStatus(response.status);ctx.pipeline(response.body)})`,
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})

it('skips malformed unrequested branded HTTP variants before schema extraction', () => {
  const source = matrix.sourceFile('variants')
  const contracts = discoverApiResponseContracts(matrix.program, [source], new Set(['POST:/rpc']))
  expect(Object.keys(contracts)).toEqual(['POST:/rpc'])
  expect(contracts['POST:/rpc']?.statusCodes).toEqual([200])
  expect(() =>
    discoverApiResponseContracts(matrix.program, [source], new Set(['POST:/rpc#protocol-2'])),
  ).toThrow('literal status')
  expect(() => discoverApiResponseContracts(matrix.program, [source])).toThrow('literal status')
})

it('preserves exact media-row suffixes when selecting one literal media variant', () => {
  const contracts = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile('media')],
    new Set(['POST:/rpc#protocol-2']),
  )
  expect(Object.keys(contracts)).toEqual(['POST:/rpc#protocol-2'])
  expect(contracts['POST:/rpc#protocol-2']?.mediaType).toBe('application/problem+json')
})

it('retains an exact selected variant as unavailable when its response association fails', () => {
  const errors: unknown[] = []
  const contracts = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile('unrelated')],
    new Set(['POST:/rpc#protocol-2']),
    { onRouteError: (error) => errors.push(error) },
  )
  expect(Object.keys(contracts)).toEqual(['POST:/rpc#protocol-2'])
  expect(contracts['POST:/rpc#protocol-2']?.unavailableReason).toContain('dominating status')
  expect(errors).toHaveLength(1)
})

it('returns no contracts for an exact protocol suffix absent from a selected route', () => {
  expect(
    discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile('media')],
      new Set(['POST:/rpc#protocol-99']),
    ),
  ).toEqual({})
})

it('skips an unrequested SSE marker that is not written to the stream', () => {
  const contracts = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile('unused-sse')],
    new Set(['GET:/events']),
  )
  expect(Object.keys(contracts)).toEqual(['GET:/events'])
})

it('preserves explicit SSE status through a constant context alias', () => {
  const contracts = discoverApiResponseContracts(matrix.program, [
    matrix.sourceFile('const-context'),
  ])
  expect(contracts['GET:/events']?.statusCodes).toEqual([201])
})

it('rejects mutable SSE context aliases instead of advertising a default status', () => {
  expect(() =>
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('mutable-context')]),
  ).toThrow('SSE context has an unsupported mutable or destructured alias')
})

it.each(['variants', 'unrelated'] as const)(
  'retains every selected sibling when HTTP %s evidence fails',
  (name) => {
    const contracts = discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile(name)],
      new Set(['POST:/rpc', 'POST:/rpc#protocol-2']),
      { onRouteError: () => {} },
    )
    expect(Object.keys(contracts)).toEqual(['POST:/rpc', 'POST:/rpc#protocol-2'])
    expect(Object.values(contracts).every((contract) => !!contract.unavailableReason)).toBe(true)
  },
)

it('allocates one bodyless row even when a variant carries irrelevant media metadata', () => {
  const contracts = discoverApiResponseContracts(matrix.program, [
    matrix.sourceFile('bodyless-extra-media'),
  ])
  expect(Object.keys(contracts)).toEqual(['POST:/rpc'])
  expect(contracts['POST:/rpc']?.bodyKind).toBe('none')
})

it('supports a constant named SSE handler registered by identifier', () => {
  const contracts = discoverApiResponseContracts(matrix.program, [matrix.sourceFile('named-sse')])
  expect(contracts['GET:/events']?.statusCodes).toEqual([201])
})

it('rejects a named emitter referenced only by an uncalled nested closure', () => {
  expect(() =>
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('deferred-named-sse')]),
  ).toThrow('must be inside an app.route handler')
})

it('rejects a rewritten named SSE handler even when its original declaration emits a frame', () => {
  expect(() =>
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('rewritten-named-sse')]),
  ).toThrow('uninvoked callback')
})

it('allows unrelated uninitialized locals in a concrete SSE handler', () => {
  expect(
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('uninitialized-local')])[
      'GET:/events'
    ]?.unavailableReason,
  ).toBeUndefined()
})

it('distinguishes private nested pipeline objects from the bound HTTP context', () => {
  expect(
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('private-pipeline')])[
      'POST:/rpc'
    ]?.unavailableReason,
  ).toBeUndefined()
})

it('does not confuse erased this with the first runtime callback argument', () => {
  expect(() =>
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('erased-this-callback')]),
  ).toThrow('uninvoked callback')
})

it('binds the actual SSE context after an erased this parameter', () => {
  expect(
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('erased-this-handler')])[
      'GET:/events'
    ]?.statusCodes,
  ).toEqual([201])
})

it('binds the actual HTTP context after an erased this parameter', () => {
  expect(
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('erased-this-http')])[
      'POST:/rpc'
    ]?.statusCodes,
  ).toEqual([200])
})

it.each(['timer-frame', 'promise-timer-helper', 'promise-created'] as const)(
  'proves the concrete platform callback path in %s',
  (name) => {
    const contract = discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)])[
      'GET:/events'
    ]
    expect(contract?.unavailableReason).toBeUndefined()
    expect(contract && responseStatusCodesForContract(contract)).toEqual([
      name === 'promise-created' ? 201 : 200,
    ])
  },
)

it('rejects a custom constructor that never invokes its frame callback', () => {
  expect(() =>
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('custom-promise')]),
  ).toThrow('uninvoked callback')
})

it('supports a registered named SSE handler without a context parameter', () => {
  const contract = discoverApiResponseContracts(matrix.program, [
    matrix.sourceFile('context-free-handler'),
  ])['GET:/events']!
  expect(responseStatusCodesForContract(contract)).toEqual([200])
})

it('does not fabricate a requested variant when a response has no carrier metadata', () => {
  const errors: unknown[] = []
  expect(
    discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile('missing-carrier')],
      new Set(['POST:/rpc#protocol-2']),
      { onRouteError: (error) => errors.push(error) },
    ),
  ).toEqual({})
  expect(errors).toHaveLength(1)
  expect(() =>
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('missing-carrier')]),
  ).toThrow('apiHttpResponseVariants')
})
