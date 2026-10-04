import { beforeAll, describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../openapi-document/index.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  type Http<T>=Response & {readonly apiHttpResponseVariants?:T};
  declare const original:Http<{status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}>;
  declare const raw:unknown;
  declare const other:any;
  declare const anyCallee:any;
  declare function apiOpenApiHttpResponse<T>(key:string,response:T):T;
  declare function apiResponse<T>(key:string,body:T):T;
  declare function opaque(callback:()=>void):void;
  declare function opaqueOptions(options:{emit:()=>void}):void;
  declare function opaqueWithContext(callback:(ctx:any)=>void):void;
  function ignore(callback:()=>void):void {}
  function ignoreOptions(options:{emit:()=>void}):void {}`
const dispatch = `const response=apiOpenApiHttpResponse('POST:/rpc',original);
  ctx.setStatus(response.status);ctx.pipeline(response.body);`
const ordinary = `ctx.json(apiResponse('POST:/rpc',{ok:true}));`
const route = (body: string, branded = true) => `${preamble}
  app.route('/rpc').post((ctx:any)=>{${body}${branded ? dispatch : ordinary}})`
const callbacks = {
  pipeline: `opaque(()=>ctx.pipeline(raw));`,
  buffer: `opaque(()=>ctx.response.buffer(raw));`,
  empty: `opaque(()=>ctx.response.empty());`,
  json: `opaque(()=>ctx.json(raw));`,
  status: `opaque(()=>ctx.setStatus(201));`,
  options: `opaqueOptions({emit:()=>ctx.pipeline(raw)});`,
  alias: `const callback=()=>ctx.pipeline(raw);opaque(callback);`,
  'captured-context': `opaqueWithContext(other=>ctx.pipeline(raw));`,
  wrapper: `const wrapper={ctx};opaque(()=>wrapper.ctx.pipeline(raw));`,
  'response-alias': `const responseAlias=ctx.response;opaque(()=>responseAlias.buffer(raw));`,
  'called-helper': `function relay(){opaque(()=>ctx.pipeline(raw))};relay();`,
  'any-callee': `anyCallee(()=>ctx.pipeline(raw));`,
  'nested-opaque': `opaque(()=>opaque(()=>ctx.pipeline(raw)));`,
} as const
const controls = {
  'dead-callback-body': `opaque(()=>{if(false)ctx.pipeline(raw)});`,
  'dead-escape': `if(false)opaque(()=>ctx.pipeline(raw));`,
  'uncalled-outer': `function unused(){opaque(()=>ctx.pipeline(raw))}`,
  'uncalled-arrow': `const unused=()=>opaque(()=>ctx.pipeline(raw));`,
  generator: `function* unused(){opaque(()=>ctx.pipeline(raw))};unused();`,
  'known-ignore': `ignore(()=>ctx.pipeline(raw));`,
  'known-options-ignore': `ignoreOptions({emit:()=>ctx.pipeline(raw)});`,
  'different-context': `opaque(()=>other.pipeline(raw));`,
  'callback-context': `opaqueWithContext(ctx=>ctx.pipeline(raw));`,
  'shadowed-callee': `const opaque=ignore;opaque(()=>ctx.pipeline(raw));`,
} as const
const sources = Object.fromEntries([
  ...Object.entries(callbacks).flatMap(([name, body]) => [
    [name, route(body)],
    ['ordinary-' + name, route(body, false)],
  ]),
  ...Object.entries(controls).flatMap(([name, body]) => [
    [name, route(body)],
    ['ordinary-' + name, route(body, false)],
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
function unavailable(rows: ReturnType<typeof discover>) {
  return buildOpenApiDocument({ title: 'Opaque callback', responseContracts: rows })[
    'x-unavailable-routes'
  ]
}

describe('opaque HTTP callbacks retain incomplete response evidence', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(Object.keys(callbacks))(
    'rejects branded callback %s in strict and lenient modes',
    (name) => {
      expect(() => discover(name)).toThrow()
      expect(unavailable(discover(name, true))).toEqual(['POST:/rpc'])
    },
  )
  it.each(Object.keys(callbacks))(
    'retains ordinary callback %s as unavailable in both modes',
    (name) => {
      for (const lenient of [false, true])
        expect(unavailable(discover('ordinary-' + name, lenient))).toEqual(['POST:/rpc'])
    },
  )
  it.each(Object.keys(controls))('preserves ignored or unrelated callback %s', (name) => {
    for (const key of [name, 'ordinary-' + name])
      for (const lenient of [false, true]) expect(unavailable(discover(key, lenient))).toEqual([])
  })
})
