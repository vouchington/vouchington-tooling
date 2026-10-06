import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const route = (body: string) => `declare const app:any;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream { write(_value:string):void{};end(_value?:unknown):void{} }
 class Other { write(_value:string):void{};end(_value?:unknown):void{} }
 const stream=new Stream();const other=new Other();const sibling=new Stream();
 const replacement=(_value?:unknown)=>{};
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  constructor: route('Stream.prototype.write=replacement'),
  instance: route('(stream as Stream & {__proto__:Stream}).__proto__.write=replacement'),
  inheritedconstructor: route('stream.constructor.prototype.write=replacement'),
  constructoralias: route('const Constructor=Stream;Constructor.prototype.write=replacement'),
  prototypealias: route('const prototype=Stream.prototype;prototype.write=replacement'),
  sibling: route('(sibling as Stream & {__proto__:Stream}).__proto__.write=replacement'),
  siblingconstructor: route('sibling.constructor.prototype.write=replacement'),
  end: route('Stream.prototype.end=replacement'),
  independent: route('Other.prototype.write=replacement'),
  independentinstance: route('(other as Other & {__proto__:Other}).__proto__.write=replacement'),
  independentconstructor: route('other.constructor.prototype.write=replacement'),
  dead: route('if(false){Stream.prototype.write=replacement}'),
  uncalled: route('function unused(){Stream.prototype.write=replacement}'),
  helper: route('function replace(){Stream.prototype.write=replacement};replace()'),
  ignored: route(
    'function ignore(_callback:()=>void){};ignore(()=>{Stream.prototype.write=replacement})',
  ),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  expect(ts.getPreEmitDiagnostics(matrix.program)).toEqual([])
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']

it.each([
  'constructor',
  'instance',
  'inheritedconstructor',
  'constructoralias',
  'prototypealias',
  'sibling',
  'siblingconstructor',
  'end',
  'helper',
] as const)('rejects selected prototype mutation: %s', (name) =>
  expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'independent',
  'independentinstance',
  'independentconstructor',
  'dead',
  'uncalled',
  'ignored',
] as const)('preserves independent or unexecuted prototype mutation: %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)
