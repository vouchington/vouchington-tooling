import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const route = (body: string) => `declare const app:any;declare function opaque(value:unknown):void;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}}const other=new Stream();
 app.route('/events').get(()=>{const stream=new Stream();${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  field: route('opaque(class {static value=stream})'),
  nested: route('opaque(class {static value={stream}})'),
  block: route('opaque(class {static value:Stream;static{this.value=stream}})'),
  closure: route('opaque(class {static value=()=>stream})'),
  alias: route('const Wrapper=class{static value=stream};opaque(Wrapper)'),
  independent: route('opaque(class {static value=other})'),
  deadfield: route('opaque(class {static value=false?stream:other})'),
  deadnested: route('opaque(class {static value={value:false?stream:other}})'),
  deadblock: route('opaque(class {static value=other;static{if(false)this.value=stream}})'),
  metadata: route('opaque(class {static metadata={name:"safe"}})'),
  unused: route('const Wrapper=class{static value=stream}'),
  instance: route('opaque(class {value=stream})'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']
it.each(['field', 'nested', 'block', 'closure', 'alias'] as const)(
  'rejects evaluated selected static class value %s',
  (name) => expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'independent',
  'deadfield',
  'deadnested',
  'deadblock',
  'metadata',
  'unused',
  'instance',
] as const)('preserves independently evaluated static class value %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)
