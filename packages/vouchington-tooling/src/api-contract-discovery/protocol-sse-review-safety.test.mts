import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  class Stream{write(_value:string):void{}}
  type Owner={stream:Stream};
  function startSSE():Owner{const stream=new Stream();return {stream}}
  declare const prior:Stream;
  declare function opaque(value:unknown):void;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  `
const frame = (stream: string) =>
  `${stream}.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{${body}})`
const sources = {
  'ambient-constructor': `${preamble}
    declare class AmbientStream{write(value:string):void}
    function cached(){const stream=new AmbientStream();return {stream}}
    app.route('/events').get(()=>{const before:unknown=prior;opaque(before);
    const {stream}=cached();${frame('stream')}})`,
  'decorated-constructor': route(`
    function cache<T extends new (...args:any[])=>Stream>(_constructor:T):T{
      return class{constructor(){return prior}write(_value:string){}} as unknown as T
    }
    @cache class DecoratedStream{write(_value:string){}}
    function cached(){const stream=new DecoratedStream();return {stream}}
    const before:unknown=prior;opaque(before);
    const {stream}=cached();${frame('stream')}`),
  'generator-declaration': route(`
    const {stream}=startSSE();function* expose(){yield stream}
    opaque(expose);${frame('stream')}`),
  'generator-expression': route(`
    const {stream}=startSSE();const expose=function*(){yield stream};
    opaque(expose);${frame('stream')}`),
  'future-let-owner': route(`
    let sse:Owner|undefined;function peek(){return sse!.stream}
    opaque(peek);sse=startSSE();${frame('sse.stream')}`),
  'future-destructured-owner': route(`
    function peek(){return stream}opaque(peek);
    const {stream}=startSSE();${frame('stream')}`),
  'future-owner-arrow': route(`
    let sse:Owner|undefined;const peek=()=>sse!.stream;
    opaque(peek);sse=startSSE();${frame('sse.stream')}`),
  'future-owner-indirect-return': route(`
    let sse:Owner|undefined;function peek(){return sse!.stream}
    function expose(){return peek()}opaque(expose);
    sse=startSSE();${frame('sse.stream')}`),
  'future-owner-indirect-effect': route(`
    let sse:Owner|undefined;function peek(){return sse!.stream}
    function expose(){opaque(peek())}opaque(expose);
    sse=startSSE();${frame('sse.stream')}`),
  'future-owner-function-alias': route(`
    let sse:Owner|undefined;function peek(){return sse!.stream}
    const expose=peek;opaque(expose);sse=startSSE();${frame('sse.stream')}`),
  'future-owner-parameter-callback': `${preamble}
    function handler(expose:()=>Stream){opaque(expose);
      const {stream}=startSSE();${frame('stream')}}
    app.route('/events').get(handler)`,
  'hoisted-nested-assignment': route(`
    let sse:Owner|undefined;init();const leaked=peek();opaque(leaked);
    ${frame('sse!.stream')}
    function init(){sse=startSSE()}function peek(){return sse!.stream}`),
  'plain-local-constructor': route(`
    const before:unknown=prior;opaque(before);
    const {stream}=startSSE();${frame('stream')}`),
  'empty-handler-before-owner': route(`
    let sse:Owner|undefined;function onAbort(){}opaque(onAbort);
    sse=startSSE();${frame('sse.stream')}`),
  'empty-arrow-before-destructure': route(`
    const onAbort=()=>{};opaque(onAbort);
    const {stream}=startSSE();${frame('stream')}`),
  'generator-unused-control': route(`
    function* unused(){yield prior}
    const {stream}=startSSE();${frame('stream')}`),
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  for (const name of Object.keys(sources) as (keyof typeof sources)[]) matrix.sourceFile(name)
})
const discover = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)])

it.each([
  'ambient-constructor',
  'decorated-constructor',
  'generator-declaration',
  'generator-expression',
  'future-let-owner',
  'future-destructured-owner',
  'future-owner-arrow',
  'future-owner-indirect-return',
  'future-owner-indirect-effect',
  'future-owner-function-alias',
  'hoisted-nested-assignment',
  'future-owner-parameter-callback',
] as const)('rejects an opaque stream escape through %s', (name) => {
  expect(() => discover(name)).toThrow('unmarked frame')
})

it.each([
  'plain-local-constructor',
  'empty-handler-before-owner',
  'empty-arrow-before-destructure',
  'generator-unused-control',
] as const)('keeps a marked frame for %s', (name) => {
  expect(discover(name)['GET:/events']?.unavailableReason).toBeUndefined()
})
