import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const stream:{write(value:string):void;end(value?:string):void};
  declare const other:typeof stream;declare function opaque(callback:any):void;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));`
const route = (body: string) => `${preamble}app.route('/events').get((ctx:any)=>{${frame}${body}})`
const sources = {
  direct: route(`opaque(()=>stream.write('raw'))`),
  nested: route(`opaque(()=>opaque(()=>stream.write('raw')))`),
  'any-callee': route(`opaque(()=>stream.write('raw'))`).replace(
    'declare function opaque(callback:any):void;',
    'declare const opaque:any;',
  ),
  alias: route(`const callback=()=>stream.write('raw');opaque(callback)`),
  options: route(`opaque({emit:()=>stream.write('raw')})`),
  shorthand: route(`const emit=()=>stream.write('raw');opaque({emit})`),
  method: route(`opaque({emit(){stream.write('raw')}})`),
  forwarded: route(
    `function forward(callback:()=>void){opaque(callback)}forward(()=>stream.write('raw'))`,
  ),
  end: route(`opaque(()=>stream.end('raw'))`),
  bracket: route(`opaque(()=>stream['write']('raw'))`),
  siblings: `${preamble}app.route('/events').get((ctx:any)=>{${frame}${frame}opaque(()=>stream.write('raw'))})`,
  dead: route(`if(false)opaque(()=>stream.write('raw'))`),
  'after-return': route(`return;opaque(()=>stream.write('raw'))`),
  unused: route(`const callback=()=>stream.write('raw')`),
  'outer-unused': route(`function unused(){opaque(()=>stream.write('raw'))}`),
  ignored: route(`function ignore(callback:()=>void){}ignore(()=>stream.write('raw'))`),
  'ignored-options': route(
    `function ignore(options:{emit:()=>void}){}ignore({emit:()=>stream.write('raw')})`,
  ),
  generator: route(`opaque(function*(){stream.write('raw')})`),
  different: route(`opaque(()=>other.write('raw'))`),
  cleanup: route(`opaque(()=>stream.end())`),
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
  'direct',
  'nested',
  'any-callee',
  'alias',
  'options',
  'shorthand',
  'method',
  'forwarded',
  'end',
  'bracket',
  'siblings',
] as const)('rejects opaque raw emission in %s', (name) => {
  expect(() => discover(name)).toThrow('unmarked frame')
  const contracts = discover(name, undefined, true)
  expect(Object.keys(contracts)).toHaveLength(name === 'siblings' ? 2 : 1)
  expect(
    Object.values(contracts).every((row) => row.unavailableReason?.includes('unmarked frame')),
  ).toBe(true)
})
it('preserves the exact selected suffix failure', () => {
  const key = 'GET:/events#protocol-2'
  const contracts = discover('siblings', [key], true)
  expect(Object.keys(contracts)).toEqual([key])
  expect(contracts[key]?.unavailableReason).toContain('unmarked frame')
})
it.each([
  'dead',
  'after-return',
  'unused',
  'outer-unused',
  'ignored',
  'ignored-options',
  'generator',
  'different',
  'cleanup',
] as const)('keeps the framed contract in %s', (name) => {
  const contracts = discover(name)
  expect(Object.keys(contracts)).toEqual(['GET:/events'])
  expect(contracts['GET:/events']?.unavailableReason).toBeUndefined()
})
