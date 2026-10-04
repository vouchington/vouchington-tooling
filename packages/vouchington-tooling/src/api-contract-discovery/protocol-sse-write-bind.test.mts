import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const stream:{write(...values:any[]):void;end(...values:any[]):void;flush(...values:any[]):void};
  declare const other:typeof stream;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{${frame}${body}})`
const siblings = (body: string) =>
  `${preamble}app.route('/events').get(()=>{${frame}${frame}${body}})`
const sources = {
  write: route(`const emit=stream.write.bind(stream);emit('raw')`),
  'bracket-write': route(`const emit=stream['write']['bind'](stream);emit('raw')`),
  'write-alias': route(`const emit=stream.write.bind(stream);const alias=emit;alias('raw')`),
  'write-prebound': route(`const emit=stream.write.bind(stream,'raw');emit()`),
  'write-inline': route(`stream.write.bind(stream,'raw')()`),
  'write-mutable': route(`let emit=stream.write.bind(stream);emit('raw')`),
  'write-no-this': route(`const emit=(stream.write.bind as any)();emit('raw')`),
  'borrowed-write': route(`const emit=other.write.bind(stream);emit('raw')`),
  'other-write': route(`const emit=stream.write.bind(other);emit('raw')`),
  end: route(`const close=stream.end.bind(stream);close('raw')`),
  'end-prebound': route(`const close=stream.end.bind(stream,'raw');close()`),
  'end-inline': route(`stream.end.bind(stream,'raw')()`),
  'ordinary-bound-method': route(`const flush=stream.flush.bind(stream);flush('log')`),
  'ordinary-bound-callback': route(`function logger(){}const invoke=logger.bind(other);invoke()`),
  'ordinary-callback': route(`const noop=()=>{};noop()`),
  'ordinary-inline': route(`(()=>{})()`),
  dead: route(`if(false){const emit=stream.write.bind(stream);emit('raw')}`),
  uncalled: route(`function never(){const emit=stream.write.bind(stream);emit('raw')}`),
  generator: route(`function* deferred(){const emit=stream.write.bind(stream);emit('raw')}`),
  ignored: route(
    `function ignore(callback:()=>void){}ignore(()=>{const emit=stream.write.bind(stream);emit('raw')})`,
  ),
  sibling: siblings(`const emit=stream.write.bind(stream);emit('raw')`),
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})

const discover = (name: keyof typeof sources, keys?: readonly string[], lenient = false) =>
  discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    keys && new Set(keys),
    lenient ? { onRouteError: () => {} } : undefined,
  )

it.each([
  'write',
  'bracket-write',
  'write-alias',
  'write-prebound',
  'write-inline',
  'write-mutable',
  'write-no-this',
  'borrowed-write',
  'end',
  'end-prebound',
  'end-inline',
] as const)('rejects bound raw bytes in %s', (name) => {
  expect(() => discover(name)).toThrow('unmarked frame')
  expect(discover(name, ['GET:/events'], true)['GET:/events']?.unavailableReason).toContain(
    'unmarked frame',
  )
})

it.each([
  'other-write',
  'ordinary-callback',
  'ordinary-inline',
  'ordinary-bound-method',
  'ordinary-bound-callback',
  'dead',
  'uncalled',
  'generator',
  'ignored',
] as const)('preserves the framed route in %s', (name) => {
  expect(discover(name)['GET:/events']?.unavailableReason).toBeUndefined()
})

it('fails only the exact selected sibling row for a bound raw write', () => {
  const key = 'GET:/events#protocol-2'
  const contracts = discover('sibling', [key], true)
  expect(Object.keys(contracts)).toEqual([key])
  expect(contracts[key]?.unavailableReason).toContain('unmarked frame')
})
