import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const route = (body: string) => `declare const app:any;declare function opaque(value:unknown):void;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}}const stream=new Stream();const other=new Stream();
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  property: route('const box:{value?:Stream}={};box.value=stream;opaque(box)'),
  element: route("const box:{value?:Stream}={};box['value']=stream;opaque(box)"),
  alias: route('const box:{value?:Stream}={};const alias=box;alias.value=stream;opaque(box)'),
  retained: route('const box:{value?:Stream}={};opaque(box);box.value=stream'),
  returned: route(
    'function build(){const box:{value?:Stream}={};box.value=stream;return box}opaque(build())',
  ),
  independent: route(
    'const box:{value?:Stream}={};box.value=other;function ignore(_value:unknown){}ignore(box)',
  ),
  dead: route('const box:{value?:Stream}={};if(false)box.value=stream;opaque(box)'),
  unused: route('const box:{value?:Stream}={};function unused(){box.value=stream}opaque(box)'),
  ignored: route(
    'const box:{value?:Stream}={};box.value=stream;function ignore(_value:unknown){}ignore(box)',
  ),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']
it.each(['property', 'element', 'alias', 'retained', 'returned'] as const)(
  'retains an actual selected capability stored into %s',
  (name) => expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each(['independent', 'dead', 'unused', 'ignored'] as const)(
  'preserves an independent or unexecuted container in %s',
  (name) => expect(row(name)?.unavailableReason).toBeUndefined(),
)
