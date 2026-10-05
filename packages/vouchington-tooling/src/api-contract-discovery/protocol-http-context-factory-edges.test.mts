import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const choose:boolean;
 declare function opaque(value:any):void;declare function apiNoContent(key:string):void;
 type Options={assertAccess?:(ctx:any)=>void};
 function factory(options:Options){return (ctx:any)=>{if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}`
const route = (declarations: string, call = 'handler(ctx)') =>
  `${preamble}${declarations}app.route('/vote').put((ctx:any)=>{apiNoContent('PUT:/vote');${call}})`
const valid = {
  shorthand: route(
    'const assertAccess=(ctx:any)=>ctx.assert(true);const handler=factory({assertAccess});',
  ),
  method: route('const handler=factory({assertAccess(ctx:any){ctx.assert(true)}});'),
  'null-spread': route(
    'const handler=factory({assertAccess:(ctx:any)=>ctx.assert(true),...(null as any)});',
  ),
  'primitive-union': route(`declare function inspect(value:string|number):void;
    function make(options:{id:string|number}){return (ctx:any)=>{inspect(options.id);ctx.setStatus(204)}}const handler=make({id:choose?'vote':1});`),
}
const invalid = {
  'else-escape': route(
    `function make(options:Options){return (ctx:any)=>{if(options.assertAccess)options.assertAccess(ctx);else opaque(ctx)}}const handler=make({});`,
  ),
  'empty-condition': route(
    'function condition():any{throw 1}function make(){return (ctx:any)=>{if(condition())opaque(ctx);ctx.setStatus(204)}}const handler=make();',
  ),
  'non-object': route('const handler=factory("options" as unknown as Options);'),
  'unknown-spread': route('declare const extra:Options;const handler=factory({...extra});'),
  computed: route('const handler=factory({[choose?"assertAccess":"other"]:opaque});'),
  'null-callee': route('', '(null as any)(ctx)'),
  'null-alternative': route(
    'const handler=choose?null:((ctx:any)=>ctx.setStatus(204));',
    '(handler as any)(ctx)',
  ),
  'null-factory': route('const handler=(null as any)();'),
  async: route(
    'async function make(){return (ctx:any)=>ctx.setStatus(204)}const handler=make() as any;',
  ),
  generator: route(
    'function* make(){return (ctx:any)=>ctx.setStatus(204)}const handler=make() as any;',
  ),
  'empty-return': route('function make():any{return}const handler=make();'),
  'spread-factory': route('const handler=factory(...([{}] as [Options]));'),
  'spread-consumer': route(
    'function handler(ctx:any,...rest:any[]){ctx.setStatus(204)}',
    'handler(ctx,...[])',
  ),
  'unknown-fallback': route(
    'declare const callback:((ctx:any)=>void)|undefined;const options:Options={};const handler=factory({assertAccess:options.assertAccess??callback});',
  ),
  'spread-alias': route(
    'const options={assertAccess:(ctx:any)=>ctx.assert(true)};const bag={...{options}};const {options:alias}=bag;alias.assertAccess=opaque;const handler=factory(bag.options);',
  ),
  'property-alias': route(
    'const options={assertAccess:(ctx:any)=>ctx.assert(true)};const bag={chosen:options};const alias=bag.chosen;alias.assertAccess=opaque;const handler=factory(bag.chosen);',
  ),
  'missing-alias': route(
    'const bag:any={options:{assertAccess:(ctx:any)=>ctx.assert(true)}};const {missing:alias}=bag;alias.assertAccess=opaque;const handler=factory(bag.options);',
  ),
  'self-result': route('function make():any{return handler}const handler=make();'),
  deleted: route(
    'const options:Options={assertAccess:(ctx:any)=>ctx.assert(true)};delete options.assertAccess;const handler=factory(options);',
  ),
}
const sources = { ...valid, ...invalid }
let matrix: VirtualProgramMatrix<keyof typeof sources>
describe('HTTP factory proofs reject unsupported values and retain literal callbacks', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(Object.keys(valid) as (keyof typeof valid)[])(
    'preserves concrete callback %s',
    (name) => {
      const rows = discoverApiResponseContracts(
        matrix.program,
        [matrix.sourceFile(name)],
        new Set(['PUT:/vote']),
      )
      expect(rows['PUT:/vote']?.unavailableReason).toBeUndefined()
      expect(responseStatusCodesForContract(rows['PUT:/vote']!)).toEqual([204])
    },
  )
  it.each(Object.keys(invalid) as (keyof typeof invalid)[])(
    'keeps uncertain callback %s unavailable',
    (name) => {
      const rows = discoverApiResponseContracts(
        matrix.program,
        [matrix.sourceFile(name)],
        new Set(['PUT:/vote']),
      )
      expect(rows['PUT:/vote']?.statusKnowledge).toBe('unknown')
      expect(rows['PUT:/vote']?.unavailableReason).toBeTruthy()
    },
  )
})
