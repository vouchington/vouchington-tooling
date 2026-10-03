import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const stream:{write(...values:any[]):void;end(...values:any[]):void;flush(...values:any[]):void};
  declare const source:{pipe(destination:typeof stream):typeof stream};
  declare const other:typeof stream;
  declare const stringPayloads:string[];declare const unknownPayloads:unknown[];
  declare function register(callback:()=>void):void;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{${frame}${body}})`
const siblingRoute = (body: string) =>
  `${preamble}app.route('/events').get(()=>{${frame}${frame}${body}})`
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
  pipe: route(`source.pipe(stream)`),
  'pipe-no-destination': route(`(source.pipe as any)()`),
  'pipe-bracket': route(`source['pipe'](stream)`),
  'pipe-call': route(`source.pipe.call(source,stream)`),
  'pipe-apply': route(`source.pipe.apply(source,[stream])`),
  'pipe-apply-other': route(`source.pipe.apply(source,[other])`),
  'pipe-apply-unknown': route(`(source.pipe as any).apply(source,unknownPayloads)`),
  'pipe-alias': route(`const destination=stream;source.pipe(destination)`),
  'pipe-other-destination': route(`source.pipe(other)`),
  'pipe-helper': route(
    `function forward(destination:typeof stream){source.pipe(destination)}forward(stream)`,
  ),
  'pipe-helper-other': route(
    `function forward(destination:typeof stream){source.pipe(destination)}forward(other)`,
  ),
  'pipe-opaque-callback': route(`register(()=>source.pipe(stream))`),
  'pipe-uncalled': route(`function never(){source.pipe(stream)}`),
  'pipe-generator': route(`function* deferred(){source.pipe(stream)}`),
  'pipe-ignored-callback': route(
    `function ignore(callback:()=>void){}ignore(()=>source.pipe(stream))`,
  ),
  'pipe-dead': route(`if(false)source.pipe(stream)`),
  'pipe-unreachable': route(`return;source.pipe(stream)`),
  'pipe-unselected-sibling': siblingRoute(`source.pipe(stream)`),
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
  'pipe',
  'pipe-bracket',
  'pipe-call',
  'pipe-apply',
  'pipe-apply-unknown',
  'pipe-alias',
  'pipe-helper',
  'pipe-opaque-callback',
  'pipe-unselected-sibling',
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
  'pipe-other-destination',
  'pipe-no-destination',
  'pipe-apply-other',
  'pipe-helper-other',
  'pipe-dead',
  'pipe-unreachable',
  'pipe-uncalled',
  'pipe-generator',
  'pipe-ignored-callback',
] as const)('preserves valid framed writes for %s', (name) => {
  expect(discover(name)['GET:/events']?.unavailableReason).toBeUndefined()
})

it('fails only the selected generated row when a pipe targets its stream', () => {
  const key = 'GET:/events#protocol-2'
  const contracts = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile('pipe-unselected-sibling')],
    new Set([key]),
    { onRouteError: () => {} },
  )
  expect(Object.keys(contracts)).toEqual([key])
  expect(contracts[key]?.unavailableReason).toContain('unmarked frame')
})
