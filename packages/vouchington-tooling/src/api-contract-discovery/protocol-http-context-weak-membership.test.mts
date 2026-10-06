import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const route = (setup: string, body: string) => `declare const app:any;
  declare function opaque(value:unknown):void;declare function apiNoContent<K extends string>(key:K):void;
  interface Ctx{json(value:unknown):void;setStatus(value:number):void;response:{empty(value?:void):void}}
  ${setup};app.route('/membership').get((ctx:Ctx)=>{${body};ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/membership'))})`
const sources = {
  actual: route('const ws=new WeakSet<Ctx>()', 'ws.has(ctx);ws.add(ctx)'),
  alias: route('const ws=new WeakSet<Ctx>();const alias=ws', 'alias.has(ctx)'),
  opaque: route('declare const ws:{has(value:Ctx):boolean}', 'ws.has(ctx)'),
  emitting: route('const ws={has(value:Ctx){value.json({raw:true});return false}}', 'ws.has(ctx)'),
  ignored: route('const ws={has(_value:Ctx){return false}}', 'ws.has(ctx)'),
  mutated: route(
    'const ws=new WeakSet<Ctx>();ws.has=(value)=>{value.json({raw:true});return false}',
    'ws.has(ctx)',
  ),
  aliaswrite: route(
    'const ws=new WeakSet<Ctx>();const alias=ws;alias.add=(value)=>{value.json({raw:true});return alias}',
    'ws.add(ctx)',
  ),
  escaped: route('const ws=new WeakSet<Ctx>();opaque(ws)', 'ws.has(ctx)'),
  wrapped: route('const ws=new WeakSet<Ctx>();opaque({ws})', 'ws.has(ctx)'),
  foreign: route(
    'declare const Foreign:WeakSetConstructor;const ws=new Foreign<Ctx>()',
    'ws.has(ctx)',
  ),
  returned: route('const ws=new WeakSet<Ctx>();function expose(){return ws}', 'ws.has(ctx)'),
  exported: route('export const ws=new WeakSet<Ctx>()', 'ws.has(ctx)'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/membership']
it.each(['actual', 'alias', 'ignored'] as const)('preserves actual bounded membership %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)
it.each([
  'opaque',
  'emitting',
  'mutated',
  'aliaswrite',
  'escaped',
  'wrapped',
  'foreign',
  'returned',
  'exported',
] as const)('rejects unknown or exposed membership %s', (name) =>
  expect(row(name)?.unavailableReason).toBeDefined(),
)
