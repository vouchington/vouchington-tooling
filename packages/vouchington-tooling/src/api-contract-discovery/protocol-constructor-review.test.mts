import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const route = (body: string) => `declare const app:any;declare function opaque(value:unknown):void;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}}const stream=new Stream();const other=new Stream();
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  captured: route(
    'class Wrapper{value:Stream;constructor(){this.value=stream}}opaque(new Wrapper())',
  ),
  container: route(
    'class Wrapper{value:{stream:Stream};constructor(){this.value={stream}}}opaque(new Wrapper())',
  ),
  expression: route('opaque(new class {value:Stream;constructor(){this.value=stream}}())'),
  invoked: route(
    'class Wrapper{value=other;constructor(){(()=>{this.value=stream})()}}opaque(new Wrapper())',
  ),
  nativeindependent: route('opaque(new Date())'),
  typedindependent: route(
    'class Wrapper{value=other;constructor(){this.value=other as typeof stream}}opaque(new Wrapper())',
  ),
  nestedoverloadunused: route(
    'class Wrapper{value=other;constructor(){function unused():Stream;function unused(){return stream}}}opaque(new Wrapper())',
  ),
  independent: route(
    'class Wrapper{value:Stream;constructor(){this.value=other}}opaque(new Wrapper())',
  ),
  unused: route('class Wrapper{value:Stream;constructor(){this.value=stream}}'),
  nestedunused: route(
    'class Wrapper{value=other;constructor(){const unused=()=>stream}}opaque(new Wrapper())',
  ),
  dead: route(
    'class Wrapper{value=other;constructor(){if(false)this.value=stream}}opaque(new Wrapper())',
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
it.each(['captured', 'container', 'expression', 'invoked'] as const)(
  'rejects reached constructor capture in %s',
  (name) => expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'independent',
  'nativeindependent',
  'typedindependent',
  'unused',
  'nestedunused',
  'nestedoverloadunused',
  'dead',
] as const)('preserves independent or unexecuted constructor path in %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)
