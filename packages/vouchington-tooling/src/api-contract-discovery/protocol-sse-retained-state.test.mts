import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import {
  buildVirtualProgramMatrix,
  COLD_VIRTUAL_PROGRAM_TIMEOUT_MS,
  type VirtualProgramMatrix,
} from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  class Stream{write(_value:string):void{}}
  type Owner={stream:Stream};
  declare function opaque(value:unknown):void;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  `
const factory = `function startSSE():Owner{const stream=new Stream();return {stream}}`
const frame = (stream: string) =>
  `${stream}.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const route = (body: string) => `${preamble}${factory}app.route('/events').get(()=>{${body}})`
const cases = {
  'retained-mutable-box': [
    route(`let sse:Owner|undefined;const box:{value?:Stream}={};opaque(box);
      sse=startSSE();box.value=sse.stream;${frame('sse.stream')}`),
    false,
  ],
  'unchanged-box': [
    route(`let sse:Owner|undefined;const box:{value?:Stream}={};opaque(box);
      sse=startSSE();${frame('sse.stream')}`),
    true,
  ],
  'previous-handler-stream': [
    `${preamble}${factory}let previous:Stream|undefined;
    app.route('/events').get(()=>{let sse:Owner|undefined;
      if(previous)opaque(previous);sse=startSSE();previous=sse.stream;
      ${frame('sse.stream')}})`,
    false,
  ],
  'constant-previous-stream': [
    `${preamble}${factory}const previous=new Stream();
    app.route('/events').get(()=>{let sse:Owner|undefined;
      opaque(previous);sse=startSSE();${frame('sse.stream')}})`,
    true,
  ],
  'async-factory-prototype': [
    `${preamble}const prior=new Stream();
    async function startSSE(){const stream=new Stream();return {stream}}
    (Promise.prototype as any).stream=prior;
    app.route('/events').get(()=>{opaque(prior);
      const {stream}=startSSE() as any;${frame('stream')}})`,
    false,
  ],
  'generator-factory-prototype': [
    `${preamble}const prior=new Stream();
    function* startSSE(){const stream=new Stream();return {stream}}
    (Object.getPrototypeOf(startSSE()) as any).stream=prior;
    app.route('/events').get(()=>{opaque(prior);
      const {stream}=startSSE() as any;${frame('stream')}})`,
    false,
  ],
  'normal-factory-control': [
    route(`const prior=new Stream();opaque(prior);
      const {stream}=startSSE();${frame('stream')}`),
    true,
  ],
} as const

let matrix: VirtualProgramMatrix<keyof typeof cases>
beforeAll(() => {
  const sources = Object.fromEntries(
    Object.entries(cases).map(([name, [source]]) => [name, source]),
  ) as Record<keyof typeof cases, string>
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  // sourceFile validates syntactic and semantic diagnostics from the actual Program.
  for (const name of Object.keys(cases) as (keyof typeof cases)[]) matrix.sourceFile(name)
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

it.each(Object.keys(cases) as (keyof typeof cases)[])(
  'checks retained stream provenance in %s',
  (name) => {
    const discover = () => discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)])
    if (cases[name][1]) expect(discover()['GET:/events']?.unavailableReason).toBeUndefined()
    else expect(discover).toThrow('unmarked frame')
  },
)
