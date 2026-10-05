import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { argumentMayReachFutureOwner } from './protocol-sse-future-owner.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
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
  'global-owner-scope': `${preamble}opaque(prior)`,
  'future-owner-array-container': `${preamble}
    function retain(box:readonly (()=>Stream)[]){return box[0]!}
    app.route('/events').get(()=>{let sse:Owner|undefined;
      const box=[()=>sse!.stream];const alias=box;
      const callback=retain(alias);opaque(callback);sse=startSSE();${frame('sse.stream')}})`,
  'future-owner-constructor': route(`
    let sse:Owner|undefined;class Accessor{peek(){return sse!.stream}}
    opaque(Accessor);sse=startSSE();${frame('sse.stream')}`),
  'external-validator-result': `${preamble}
    declare function validateId():string;
    app.route('/events').get(()=>{const id=validateId();opaque(id);
      const {stream}=startSSE();${frame('stream')}})`,
  'external-data-result': `${preamble}
    declare function readUser():Promise<{id:string}>;
    app.route('/events').get(async()=>{const user=await readUser();opaque(user.id);
      let sse:Owner|undefined;sse=startSSE();${frame('sse.stream')}})`,
  'external-cleanup-before-owner': `${preamble}
    declare const subscription:{close():Promise<void>};
    app.route('/events').get(()=>{let sse:Owner|undefined;
      let closePromise:Promise<void>|undefined;const pending=false;
      function closeSubscription(){if(pending)return;
        closePromise=Promise.resolve(subscription.close())}
      opaque(closeSubscription);sse=startSSE();${frame('sse.stream')}})`,
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
  'future-owner-constructor',
  'future-owner-array-container',
] as const)('rejects an opaque stream escape through %s', (name) => {
  expect(() => discover(name)).toThrow('unmarked frame')
})

it.each([
  'plain-local-constructor',
  'empty-handler-before-owner',
  'empty-arrow-before-destructure',
  'generator-unused-control',
  'external-validator-result',
  'external-data-result',
  'external-cleanup-before-owner',
] as const)('keeps a marked frame for %s', (name) => {
  expect(discover(name)['GET:/events']?.unavailableReason).toBeUndefined()
})

it('keeps an owner without a known function scope unknown', () => {
  const source = matrix.sourceFile('global-owner-scope')
  const statement = source.statements.find(
    (node): node is ts.ExpressionStatement =>
      ts.isExpressionStatement(node) && ts.isCallExpression(node.expression),
  )!
  const call = statement.expression as ts.CallExpression
  const checker = matrix.program.getTypeChecker()
  const receiver = expressionReceiver(call.arguments[0]!, checker)!
  expect(argumentMayReachFutureOwner(receiver, receiver, checker)).toBe(true)
})
