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
  function startSSE():Owner{const stream=new Stream();return {stream}}
  declare function opaque(value:unknown):void;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  `
const frame = `sse.stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const sources = {
  'owner-alias-write': `${preamble}app.route('/events').get(()=>{
    let sse:Owner|undefined;const prior=new Stream();opaque(prior);
    sse=startSSE();const alias=sse;alias.stream=prior;${frame}})`,
  'immutable-owner-alias': `${preamble}app.route('/events').get(()=>{
    let sse:Owner|undefined;const prior=new Stream();opaque(prior);
    sse=startSSE();const alias=sse;void alias.stream;${frame}})`,
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  // Validate both actual compiler sources, including all semantic diagnostics.
  for (const name of Object.keys(sources) as (keyof typeof sources)[]) matrix.sourceFile(name)
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

it('rejects a marked write after an owner alias replaces the selected stream', () => {
  expect(() =>
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile('owner-alias-write')]),
  ).toThrow('unmarked frame')
})
it('keeps an immutable owner alias on the original fresh stream', () => {
  const contract = discoverApiResponseContracts(matrix.program, [
    matrix.sourceFile('immutable-owner-alias'),
  ])['GET:/events']
  expect(contract).toBeDefined()
  expect(contract?.unavailableReason).toBeUndefined()
})
