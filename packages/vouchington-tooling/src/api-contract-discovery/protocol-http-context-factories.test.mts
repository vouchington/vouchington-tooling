import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare function apiNoContent(key:string):void;
 declare function opaque(value:any):void;declare const choose:boolean;`
const route = (declarations: string, invocation = 'handler(ctx)') =>
  `${preamble}${declarations}app.route('/vote').put((ctx:any)=>{apiNoContent('PUT:/vote');${invocation}})`
const options = `type Options={assertAccess?:(ctx:any)=>void;assertClearAccess?:(ctx:any)=>void;preAssertAccess?:(ctx:any)=>void};`
const factory = `${options}function factory(options:Options,clear:boolean){return async function handle(ctx:any){
 if(options.preAssertAccess)await options.preAssertAccess(ctx);
 const access=options[clear?'assertClearAccess':'assertAccess']??options.assertAccess;
 if(access)await access(ctx);ctx.setStatus(204)}}`
const valid = {
  primitive: route(
    `${options}declare function inspect(value:string):void;function factory(options:Options & {routeKey:string}){return (ctx:any)=>{inspect(options.routeKey);if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}const handler=factory({routeKey:'PUT:/vote',assertAccess:ctx=>ctx.assert(true)});`,
  ),
  direct: route('function handler(ctx:any){ctx.setStatus(204)}'),
  named: route(
    'function factory(){return function handle(ctx:any){ctx.setStatus(204)}}const handler=factory();',
  ),
  arrow: route('function factory(){return (ctx:any)=>ctx.setStatus(204)}const handler=factory();'),
  chain: route(
    'function factory(){return (ctx:any)=>ctx.setStatus(204)}function wrapper(){return factory()}const handler=wrapper();',
  ),
  bound: route(
    `${options}function handler(ctx:any,options:Options){if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}`,
    'handler(ctx,{assertAccess:ctx=>ctx.assert(true)})',
  ),
  computed: route(
    `${factory}const handler=factory({assertAccess:ctx=>ctx.assert(true),assertClearAccess:ctx=>ctx.assert(true)},choose);`,
  ),
  absent: route(`${factory}const handler=factory({},false);`),
  spread: route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};const handler=factory({...options,assertClearAccess:(ctx:any)=>ctx.assert(true)},true);`,
  ),
  undefined: route(
    `${factory}const options={assertAccess:opaque};const handler=factory({...options,assertAccess:undefined},false);`,
  ),
  override: route(
    `${factory}const options={assertAccess:opaque};const handler=factory({...options,assertAccess:(ctx:any)=>ctx.assert(true)},false);`,
  ),
}
const invalid = {
  unknown: route('declare function factory():(ctx:any)=>void;const handler=factory();'),
  unsafe: route('function factory(){return (ctx:any)=>opaque(ctx)}const handler=factory();'),
  branch: route(
    `${factory}const handler=factory({assertAccess:ctx=>ctx.assert(true),assertClearAccess:opaque},choose);`,
  ),
  mutated: route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};options.assertAccess=opaque;const handler=factory(options,false);`,
  ),
  'spread-branch': route(
    `${factory}const options={assertAccess:opaque};const extra=choose?{}:{assertAccess:(ctx:any)=>ctx.assert(true)};const handler=factory({...options,...extra},false);`,
  ),
  'shorthand-alias-chain': route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};const original=options;const bag={original};const {original:alias}=bag;alias.assertAccess=opaque;const handler=factory(options,false);`,
  ),
  'member-alias-chain': route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};const bag={inner:options};const nested={outer:bag.inner};const alias=nested.outer;alias.assertAccess=opaque;const handler=factory(options,false);`,
  ),
  destructured: route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};const bag={options};const {options:alias}=bag;alias.assertAccess=opaque;const handler=factory(bag.options,false);`,
  ),
  'member-alias': route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};const bag={options};const alias=bag.options;alias.assertAccess=opaque;const handler=factory(bag.options,false);`,
  ),
  alias: route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};const alias=options;alias.assertAccess=opaque;const handler=factory(options,false);`,
  ),
  assign: route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};Object.assign(options,{assertAccess:opaque});const handler=factory(options,false);`,
  ),
  'object-member': route(
    `${factory}declare function mutate(value:Options):void;const container={options:{assertAccess:(ctx:any)=>ctx.assert(true)}};mutate(container.options);const handler=factory(container.options,false);`,
  ),
  forwarded: route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};function mutate(value:Options){value.assertAccess=opaque}mutate(options);const handler=factory(options,false);`,
  ),
  escaped: route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};opaque(options);const handler=factory(options,false);`,
  ),
  getter: route(
    `${factory}const handler=factory({get assertAccess(){return (ctx:any)=>opaque(ctx)},assertClearAccess:ctx=>ctx.assert(true)},false);`,
  ),
  prototype: route(
    `${factory}const options={__proto__:{assertAccess:opaque},assertClearAccess:(ctx:any)=>ctx.assert(true)};const handler=factory(options,false);`,
  ),
  reflect: route(
    `${factory}const options={assertAccess:(ctx:any)=>ctx.assert(true)};Reflect.set(options,'assertAccess',opaque);const handler=factory(options,false);`,
  ),
  written: route(
    'let factory=()=>((ctx:any)=>ctx.setStatus(204));factory=()=>opaque;const handler=factory();',
  ),
  fallthrough: route(
    'function factory(){if(choose)return (ctx:any)=>ctx.setStatus(204)}const handler=factory()!;',
  ),
  cyclic: route('function factory():any{return factory()}const handler=factory();'),
}
const sources = { ...valid, ...invalid }
let matrix: VirtualProgramMatrix<keyof typeof sources>
describe('HTTP context factory consumers retain concrete callback bindings', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(Object.keys(valid) as (keyof typeof valid)[])('preserves proven consumer %s', (name) => {
    for (const selected of [undefined, new Set(['PUT:/vote'])]) {
      const rows = discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], selected)
      expect(rows['PUT:/vote']?.unavailableReason).toBeUndefined()
      expect(responseStatusCodesForContract(rows['PUT:/vote']!)).toEqual([204])
    }
  })
  it.each(Object.keys(invalid) as (keyof typeof invalid)[])(
    'keeps uncertain consumer %s unavailable',
    (name) => {
      for (const selected of [undefined, new Set(['PUT:/vote'])]) {
        const rows = discoverApiResponseContracts(
          matrix.program,
          [matrix.sourceFile(name)],
          selected,
          { onRouteError: () => {} },
        )
        expect(rows['PUT:/vote']?.statusKnowledge).toBe('unknown')
        expect(rows['PUT:/vote']?.unavailableReason).toBeTruthy()
      }
    },
  )
})
