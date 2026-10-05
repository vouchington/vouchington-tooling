import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  class Stream{write(_value:string){return true}}
  type SSEContext={stream:Stream};
  function start(ctx:any):SSEContext{
    const stream=new Stream();ctx.pipeline(stream);return {stream}}`
const frame = `apiSseFrame('GET:/events',{event:'done' as const,data:{ok:true}})`
const sources = {
  'framed-get': `${preamble}
    app.route('/events').get((ctx:any)=>{
      const holder=start(ctx);holder.stream.write(${frame})})`,
  'shared-helper': `${preamble}
    app.route('/events').get((ctx:any)=>{
      const holder=start(ctx);holder.stream.write(${frame})});
    app.route('/plain').put((ctx:any)=>{
      apiNoContent('PUT:/plain');start(ctx)})`,
  'second-stream': `${preamble}
    app.route('/events').get((ctx:any)=>{
      const first=start(ctx);start(ctx);first.stream.write(${frame})})`,
  'manual-json': `${preamble.replace('ctx.pipeline(stream);', 'ctx.pipeline(stream);ctx.json({unexpected:true});')}
    app.route('/events').get((ctx:any)=>{
      const holder=start(ctx);holder.stream.write(${frame})})`,
  'missing-pipeline-stream': `${preamble.replace('ctx.pipeline(stream);', 'ctx.pipeline();')}
    app.route('/events').get((ctx:any)=>{
      const holder=start(ctx);holder.stream.write(${frame})})`,
  'captured-context-pipeline': `${preamble.replace(
    'ctx.pipeline(stream);',
    'function emit(n:number){ctx.pipeline(stream)}emit(1);',
  )}
    app.route('/events').get((ctx:any)=>{
      const holder=start(ctx);holder.stream.write(${frame})})`,
} as const
type SourceName = keyof typeof sources
let matrix: VirtualProgramMatrix<SourceName>

function contracts(name: SourceName, keys: readonly string[]) {
  return discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], new Set(keys))
}

describe('HTTP context emissions follow the selected SSE route and stream', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
    for (const name of Object.keys(sources) as SourceName[]) matrix.sourceFile(name)
  })

  it('keeps a framed stream returned through an explicit helper result as SSE', () => {
    const row = contracts('framed-get', ['GET:/events'])['GET:/events']
    expect(row?.unavailableReason).toBeUndefined()
    expect(row?.statusKnowledge).toBe('default')
    expect(responseStatusCodesForContract(row!)).toEqual([200])
    expect(row?.mediaType).toBe('text/event-stream')
    expect(row?.sseEvents?.length).toBe(1)
  })

  it('does not reuse GET framing for an unframed PUT call to the shared helper', () => {
    const rows = contracts('shared-helper', ['GET:/events', 'PUT:/plain'])
    expect(rows['GET:/events']?.mediaType).toBe('text/event-stream')
    expect(rows['GET:/events']?.unavailableReason).toBeUndefined()
    expect(rows['PUT:/plain']?.statusKnowledge).toBe('unknown')
    expect(rows['PUT:/plain']?.unavailableReason).toBeTruthy()
  })

  it('rejects a second pipelined stream when only the first stream has a frame', () => {
    const row = contracts('second-stream', ['GET:/events'])['GET:/events']
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('rejects a manual JSON body inside the framed SSE helper', () => {
    const row = contracts('manual-json', ['GET:/events'])['GET:/events']
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('rejects a framed helper whose pipeline has no stream argument', () => {
    const row = contracts('missing-pipeline-stream', ['GET:/events'])['GET:/events']
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('rejects a nested emitter that captures context instead of receiving it first', () => {
    const row = contracts('captured-context-pipeline', ['GET:/events'])['GET:/events']
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })
})
