import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const route = (body: string) => `declare const app:any;
 declare function apiNoContent(key:string):void;
 declare function opaque(value:unknown):void;
 type Context={response:{json(value:unknown):void};json(value:unknown):void;setStatus(value:number):void;assert(value:boolean):void};
 function factory(options:{assertAccess:(ctx:Context)=>void}){return(ctx:Context)=>{
 options.assertAccess(ctx);ctx.setStatus(204)}}
 const options={assertAccess:(ctx:Context)=>{${body}}};
 app.route('/vote').put((ctx:Context)=>{apiNoContent('PUT:/vote');factory(options)(ctx)});export {};`
const sources = {
  field: route('opaque(class {static context=ctx})'),
  response: route('opaque(class {static context=ctx.response})'),
  nested: route('opaque(class {static context={selected:ctx}})'),
  block: route('opaque(class {static context:unknown;static {this.context=ctx}})'),
  blockescape: route('opaque(class {static {opaque(ctx)}})'),
  callback: route('opaque(class {static emit=()=>ctx.json({bad:true})})'),
  independent: route('opaque(class {static context={independent:true}})'),
  deadfield: route('opaque(class {static context=false?ctx:{}})'),
  deadblock: route('opaque(class {static context:unknown;static {if(false)this.context=ctx}})'),
  independentblock: route(
    'opaque(class {static context:unknown;static {this.context={independent:true}}})',
  ),
  unused: route('class Unused {static context=ctx};ctx.assert(true)'),
  unreachable: route('if(false)opaque(class {static context=ctx})'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  expect(ts.getPreEmitDiagnostics(matrix.program)).toEqual([])
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], new Set(['PUT:/vote']))[
    'PUT:/vote'
  ]
it.each(['field', 'response', 'nested', 'block', 'blockescape', 'callback'] as const)(
  'rejects evaluated class capture: %s',
  (name) => {
    expect(row(name)?.statusKnowledge).toBe('unknown')
    expect(row(name)?.unavailableReason).toBeTruthy()
  },
)
it.each([
  'independent',
  'deadfield',
  'deadblock',
  'independentblock',
  'unused',
  'unreachable',
] as const)('preserves unrelated or unexecuted class: %s', (name) => {
  const value = row(name)
  expect(value?.unavailableReason).toBeUndefined()
  expect(responseStatusCodesForContract(value!)).toEqual([204])
})
