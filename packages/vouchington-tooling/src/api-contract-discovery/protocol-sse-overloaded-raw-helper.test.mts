import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  type Stream={write(value:string):void};
  declare const stream:Stream;
  declare const other:Stream;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));`
const sources = {
  selected: `${preamble}function raw(output:Stream):void;function raw(output:Stream){output.write('raw')}app.route('/events').get(()=>{${frame}raw(stream)})`,
  arrow: `${preamble}const raw=(output:Stream)=>output.write('raw');app.route('/events').get(()=>{${frame}raw(stream)})`,
  expression: `${preamble}const raw=function(output:Stream){output.write('raw')};app.route('/events').get(()=>{${frame}raw(stream)})`,
  'method-overload': `${preamble}class Writer{raw(output:Stream):void;raw(output:Stream){output.write('raw')}}const writer=new Writer();app.route('/events').get(()=>{${frame}writer.raw(stream)})`,
  siblings: `${preamble}function raw(output:Stream):void;function raw(output:Stream){output.write('raw')}app.route('/events').get(()=>{${frame}${frame}raw(stream)})`,
  other: `${preamble}function raw(output:Stream):void;function raw(output:Stream){output.write('raw')}app.route('/events').get(()=>{${frame}raw(other)})`,
  deferred: `${preamble}function raw(output:Stream):void;function raw(output:Stream){output.write('raw')}app.route('/events').get(()=>{${frame}function never(){raw(stream)}})`,
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

it('matches overloaded helper calls to their implementation for selected streams', () => {
  expect(() => discover('selected')).toThrow('unmarked frame')
  expect(discover('selected', true)['GET:/events']?.unavailableReason).toContain('unmarked frame')
})

it.each(['arrow', 'expression', 'method-overload'] as const)(
  'preserves body-bearing %s helper call matching',
  (name) => {
    expect(() => discover(name)).toThrow('unmarked frame')
    expect(discover(name, true)['GET:/events']?.unavailableReason).toContain('unmarked frame')
  },
)

it('retains the overload failure for an exact generated protocol row', () => {
  const key = 'GET:/events#protocol-2'
  const contracts = discover('siblings', true)
  expect(contracts[key]?.unavailableReason).toContain('unmarked frame')
})

it.each(['other', 'deferred'] as const)(
  'preserves unrelated and deferred overload calls in %s',
  (name) => {
    const contracts = discover(name)
    expect(contracts['GET:/events']?.unavailableReason).toBeUndefined()
  },
)
