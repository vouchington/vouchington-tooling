import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  declare const stream:{write(value:string):void};
  declare const other:typeof stream;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;`
const frame = `apiSseFrame('GET:/events',{event:'done' as const,data:{}})`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{${body}})`
const sources = {
  shorthand: route(`const output={stream};output.stream.write(${frame});stream.write('raw')`),
  property: route(`const output={target:stream};output.target.write(${frame});stream.write('raw')`),
  'raw-wrapper': route(`stream.write(${frame});const output={stream};output.stream.write('raw')`),
  'raw-property': route(
    `stream.write(${frame});const output={target:stream};output.target.write('raw')`,
  ),
  annotated: route(
    `stream.write(${frame});const output:{stream:typeof stream}={stream};output.stream.write('raw')`,
  ),
  replaced: route(`const output={stream};output.stream=other;output.stream.write(${frame})`),
  cycle: route(`// @ts-expect-error Deliberately cyclic wrapper cannot prove a runtime receiver.
    const output:{stream:typeof stream}={stream:output.stream};output.stream.write(${frame})`),
  different: route(`stream.write(${frame});const output={stream:other};output.stream.write('log')`),
  direct: route(`stream.write(${frame})`),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})

it.each([
  'shorthand',
  'property',
  'raw-wrapper',
  'raw-property',
  'annotated',
  'replaced',
  'cycle',
] as const)('fails closed for wrapper receiver %s', (name) => {
  const discover = (lenient = false) =>
    discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile(name)],
      undefined,
      lenient ? { onRouteError: () => {} } : undefined,
    )
  expect(() => discover()).toThrow()
  expect(Object.values(discover(true)).every((value) => value.unavailableReason)).toBe(true)
})
it.each(['different', 'direct'] as const)('keeps unrelated or direct writes in %s', (name) => {
  const contracts = Object.values(
    discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)]),
  )
  expect(contracts).toHaveLength(1)
  expect(contracts[0]?.unavailableReason).toBeUndefined()
})
