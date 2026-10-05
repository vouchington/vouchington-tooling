import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const route = (body: string) => `declare const app:any;declare function opaque(value:unknown):void;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}cleanup(_strings?:TemplateStringsArray):void{}}const stream=new Stream();const other=new Stream();
 declare function opaqueResult(value:Stream):Stream;
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  callbackalias: route('const callback=()=>stream;opaque(callback)'),
  callbackother: route('const callback=()=>other;opaque(callback)'),
  tagreceiver: route('(stream as Stream & {raw(strings:TemplateStringsArray):void}).raw`value`'),
  tagreceiverother: route(
    '(other as Stream & {raw(strings:TemplateStringsArray):void}).raw`value`',
  ),
  tagcleanup: route('stream.cleanup`value`'),
  tagambient: route('external`value`').replace(
    'app.route',
    'declare function external(strings:TemplateStringsArray):void;app.route',
  ),
  taggenerator: route(
    "function* emit(_strings:TemplateStringsArray){stream.write('raw')}emit`value`",
  ),
  tagoutside: route('').replace(
    'app.route',
    "function emit(_strings:TemplateStringsArray){other.write('raw')}emit`value`;app.route",
  ),
  tagtwice: route(
    "function emit(_strings:TemplateStringsArray){other.write('raw')}emit`one`;emit`two`",
  ),
  tagraw: route("function emit(_strings:TemplateStringsArray){stream.write('raw')}emit`value`"),
  tagsafe: route("function emit(_strings:TemplateStringsArray){other.write('raw')}emit`value`"),
  tagunused: route("function emit(_strings:TemplateStringsArray){stream.write('raw')}"),
  tagdead: route(
    "function emit(_strings:TemplateStringsArray){stream.write('raw')}if(false)emit`value`",
  ),
  callbackblock: route('opaque([{callback:function(){return stream}}])'),
  elementmethod: route('(stream as Stream & {raw():void})["raw"]()'),
  concretecleanup: route('stream.cleanup()'),
  deadmethod: route('if(false)(stream as Stream & {raw():void}).raw()'),
  wrapper: route('opaque({callback:()=>stream})'),
  wrapperother: route('opaque({callback:()=>other})'),
  method: route('(stream as Stream & {raw():void}).raw()'),
  methodother: route('(other as Stream & {raw():void}).raw()'),
  captured: route('function capture(){return stream}opaque(capture())'),
  closure: route('function wrap(value:Stream){return ()=>value}opaque(wrap(stream))'),
  cycle: route('function repeat(value:Stream):Stream{return repeat(value)}opaque(repeat(stream))'),
  rest: route('function wrap(...values:Stream[]){return values}opaque(wrap(stream))'),
  opaque: route('opaque(opaqueResult(stream))'),
  conditional: route(
    'function wrap(value:Stream){return Math.random()?value:other}opaque(wrap(stream))',
  ),
  logical: route('function wrap(value:Stream){return value||other}opaque(wrap(stream))'),
  identity: route('function identity(value:Stream){return value}opaque(identity(stream))'),
  container: route('function identity(value:Stream){return {value}}opaque(identity(stream))'),
  alias: route(
    'function identity(value:Stream){const alias=value;return alias}opaque(identity(stream))',
  ),
  omitted: route('function count(_value?:Stream){return 1}opaque(count())'),
  alternate: route(
    'function wrap(value:Stream){return Math.random()?other:value}opaque(wrap(stream))',
  ),
  fallback: route('function wrap(value:Stream){return other||value}opaque(wrap(stream))'),
  scalar: route('function count(_value:Stream){return 1}opaque(count(stream))'),
  separate: route('function identity(value:Stream){return value}opaque(identity(other))'),
  fresh: route('function make(_value:Stream){return {value:1}}opaque(make(stream))'),
  forof: route('for(stream.write of [(_value:string)=>{}]){}'),
  forin: route('for((stream as any).write in {replacement:1}){}'),
  loopother: route('for(other.write of [(_value:string)=>{}]){}'),
  deadloop: route('if(false)for(stream.write of [(_value:string)=>{}]){}'),
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
  'callbackalias',
  'tagreceiver',
  'tagraw',
  'callbackblock',
  'elementmethod',
  'wrapper',
  'method',
  'identity',
  'container',
  'alias',
  'captured',
  'closure',
  'cycle',
  'rest',
  'opaque',
  'conditional',
  'logical',
  'alternate',
  'fallback',
  'forof',
  'forin',
] as const)('rejects selected capability in %s', (name) =>
  expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'callbackother',
  'tagreceiverother',
  'tagcleanup',
  'tagambient',
  'taggenerator',
  'tagoutside',
  'tagtwice',
  'tagsafe',
  'tagunused',
  'tagdead',
  'concretecleanup',
  'deadmethod',
  'wrapperother',
  'methodother',
  'omitted',
  'scalar',
  'separate',
  'fresh',
  'loopother',
  'deadloop',
] as const)('preserves independent behavior in %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)
