import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const route = (body: string) => `declare const app:any;declare function opaque(value:unknown):void;
 declare function opaqueTag(strings:TemplateStringsArray,...values:unknown[]):void;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}}const stream=new Stream();const other=new Stream();
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  spread: route('opaque({...{expose(){return stream}}})'),
  spreadother: route('opaque({...{expose(){return other}}})'),
  method: route('opaque({expose(){return stream}})'),
  write: route("opaque({expose(){stream.write('raw')}})"),
  getter: route('opaque({get expose(){return stream}})'),
  setter: route("opaque({set expose(_value:unknown){stream.write('raw')}})"),
  tag: route('opaqueTag`value:${{expose(){return stream}}}`'),
  returned: route('function wrap(){return {expose(){return stream}}}opaque(wrap())'),
  independent: route('opaque({expose(){return other}})'),
  unused: route('const wrapper={expose(){return stream}}'),
  ignored: route('function ignore(_value:unknown){}ignore({expose(){return stream}})'),
  scalar: route('opaque({expose(){return 1}})'),
  getterother: route('opaque({get expose(){return other}})'),
  setterother: route("opaque({set expose(_value:unknown){other.write('raw')}})"),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']
it.each(['spread', 'method', 'write', 'getter', 'setter', 'tag', 'returned'] as const)(
  'rejects selected capability in %s',
  (name) => expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'spreadother',
  'independent',
  'unused',
  'ignored',
  'scalar',
  'getterother',
  'setterother',
] as const)('preserves independent behavior in %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)
