import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const route = (body: string) => `declare const app:any;declare function opaque(value:unknown):void;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}}const stream=new Stream();const other=new Stream();
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  field: route('class Wrapper{value=stream}opaque(new Wrapper())'),
  container: route('class Wrapper{value={stream}}opaque(new Wrapper())'),
  expression: route('opaque(new class {value=stream}())'),
  bound: route('opaque((()=>stream).bind(null))'),
  boundwrite: route("opaque((()=>{stream.write('raw')}).bind(null))"),
  boundalias: route('const callback=()=>stream;opaque(callback.bind(null))'),
  independent: route('class Wrapper{value=other}opaque(new Wrapper())'),
  unused: route('class Wrapper{value=stream}'),
  boundother: route('opaque((()=>other).bind(null))'),
  boundunused: route('const callback=(()=>stream).bind(null)'),
  ignored: route('function ignore(_value:unknown){}ignore((()=>stream).bind(null))'),
  custombind: route('opaque(({bind(){return 1}}).bind())'),
  scalar: route('opaque((()=>1).bind(null))'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']
it.each(['field', 'container', 'expression', 'bound', 'boundwrite', 'boundalias'] as const)(
  'rejects selected capability in %s',
  (name) => expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'independent',
  'unused',
  'boundother',
  'boundunused',
  'ignored',
  'custombind',
  'scalar',
] as const)('preserves independent behavior in %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)
