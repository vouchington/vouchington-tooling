import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const stream:{write(...values:any[]):void;end(...values:any[]):void;flush(...values:any[]):void};
  declare const other:typeof stream;
  declare const stringPayloads:string[];declare const unknownPayloads:unknown[];
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{${frame}${body}})`
const sources = {
  call: route(`stream.write.call(stream,'raw')`),
  'call-no-this': route(`(stream.write as any).call()`),
  'call-other-this': route(`stream.write.call(other,'raw')`),
  'borrowed-call-framed-this': route(`other.write.call(stream,'raw')`),
  'borrowed-call-other-this': route(`other.write.call(other,'raw')`),
  'call-unknown-method': route(`stream.flush.call(stream,'raw')`),
  'apply-static': route(`stream.write.apply(stream,['raw'])`),
  'apply-unknown': route(`stream.write.apply(stream,stringPayloads)`),
  'apply-spread': route(`stream.write.apply(stream,[...stringPayloads])`),
  'apply-empty': route(`stream.write.apply(stream)`),
  'apply-undefined': route(`stream.write.apply(stream,undefined as any)`),
  'end-call-empty': route(`stream.end.call(stream)`),
  'end-call-undefined': route(`stream.end.call(stream,undefined)`),
  'end-call-callback': route(`stream.end.call(stream,()=>{})`),
  'end-call-payload': route(`stream.end.call(stream,'raw')`),
  'end-apply-empty': route(`stream.end.apply(stream,[])`),
  'end-apply-null': route(`stream.end.apply(stream,null as any)`),
  'end-apply-callback': route(`stream.end.apply(stream,[()=>{}])`),
  'end-apply-unknown': route(`stream.end.apply(stream,unknownPayloads)`),
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})

const discover = (name: keyof typeof sources, lenient = false) =>
  discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )

it.each([
  'call',
  'borrowed-call-framed-this',
  'call-unknown-method',
  'apply-static',
  'apply-unknown',
  'apply-spread',
  'end-call-payload',
  'end-apply-unknown',
] as const)('rejects unframed bytes emitted through %s', (name) => {
  expect(() => discover(name)).toThrow('unmarked frame')
  expect(discover(name, true)['GET:/events']?.unavailableReason).toContain('unmarked frame')
})

it.each([
  'call-no-this',
  'call-other-this',
  'borrowed-call-other-this',
  'apply-empty',
  'apply-undefined',
  'end-call-empty',
  'end-call-undefined',
  'end-call-callback',
  'end-apply-empty',
  'end-apply-null',
  'end-apply-callback',
] as const)('preserves valid framed writes for %s', (name) => {
  expect(discover(name)['GET:/events']?.unavailableReason).toBeUndefined()
})
