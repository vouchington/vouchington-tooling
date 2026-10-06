import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const route = (body: string) => `declare const app:any;declare function opaque(value:unknown):void;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}}const stream=new Stream();const other=new Stream();
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  repeated: route('const value={other};opaque({first:value,second:value})'),
  alias: route('const wrapper={other};opaque(wrapper)'),
  array: route('const wrapper=[other];opaque(wrapper)'),
  dead: route('const box:{value?:Stream}={};if(false)box.value=stream;opaque(box)'),
  unused: route('const box:{value?:Stream}={};function unused(){box.value=stream}opaque(box)'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
it.each(['repeated', 'alias', 'array', 'dead', 'unused'] as const)(
  'retains the published conservative opaque container boundary in %s',
  (name) =>
    expect(
      discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
        onRouteError: () => {},
      })['GET:/events']?.unavailableReason,
    ).toBe('SSE route writes an unmarked frame'),
)
