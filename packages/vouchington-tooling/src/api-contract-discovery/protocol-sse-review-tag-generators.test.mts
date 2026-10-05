import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { sseCapabilityOutputs } from './protocol-sse-capability-outputs.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const route = (body: string) => `declare const app:any;declare function opaque(value:unknown):void;
 declare function opaqueTag(strings:TemplateStringsArray,...values:unknown[]):void;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}}const stream=new Stream();const other=new Stream();
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  tagstream: route('opaqueTag`value:${stream}`'),
  taginline: route('opaqueTag`value:${()=>stream}`'),
  tagscalar: route('opaqueTag`value:${1}`'),
  tagother: route('opaqueTag`value:${other}`'),
  tagalias: route('const callback=()=>stream;opaqueTag`value:${callback}`'),
  tagcapture: route("const callback=()=>{stream.write('raw')};opaqueTag`value:${callback}`"),
  yieldstream: route('opaque(function*(){yield stream})'),
  yieldcontainer: route('opaque(function*(){yield {stream}})'),
  yieldnamed: route('function* callback(){yield stream}opaque(callback)'),
  tagindependent: route('const callback=()=>other;opaqueTag`value:${callback}`'),
  tagunused: route('const callback=()=>stream'),
  yieldindependent: route('opaque(function*(){yield other})'),
  yieldunused: route('function* callback(){yield stream}'),
  yieldnested: route('opaque(function*(){function* unused(){yield stream}yield other})'),
  yielddead: route('opaque(function*(){if(false)yield stream;yield other})'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']
it.each([
  'tagstream',
  'taginline',
  'tagalias',
  'tagcapture',
  'yieldstream',
  'yieldcontainer',
  'yieldnamed',
] as const)('rejects selected capability in %s', (name) =>
  expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'tagscalar',
  'tagother',
  'tagindependent',
  'tagunused',
  'yieldindependent',
  'yieldunused',
] as const)('preserves independent behavior in %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)

it.each(['yieldnested', 'yielddead'] as const)('keeps own outputs bounded in %s', (name) => {
  let generator: ts.FunctionExpression | undefined
  function find(node: ts.Node): void {
    if (ts.isFunctionExpression(node) && node.asteriskToken) generator ??= node
    ts.forEachChild(node, find)
  }
  find(matrix.sourceFile(name))
  expect(generator).toBeDefined()
  expect(sseCapabilityOutputs(generator!).map((value) => value?.getText())).toEqual(['other'])
})
