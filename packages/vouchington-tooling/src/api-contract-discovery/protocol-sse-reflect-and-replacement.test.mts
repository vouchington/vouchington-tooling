import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  declare const stream:{write(value:string):void;end(value?:unknown):void};
  declare const other:typeof stream;
  declare const source:{pipe(destination:typeof stream):void};
  declare const dynamicArguments:any[];
  declare function getStream():typeof stream;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  declare function opaque(callback:()=>void):void;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{${body}})`
const sources = {
  reflect: route(`${frame}Reflect.apply(stream.write,stream,['raw'])`),
  'reflect-suffix': route(`${frame}${frame}Reflect.apply(stream.write,stream,['raw'])`),
  'reflect-unknown-payload': route(`${frame}Reflect.apply(stream.write,stream,dynamicArguments)`),
  'reflect-pipe': route(`${frame}Reflect.apply(source.pipe,source,[stream])`),
  'reflect-cleanup': route(`${frame}Reflect.apply(stream.end,stream,[()=>{}])`),
  'reflect-empty-write': route(`${frame}Reflect.apply(stream.write,stream,[])`),
  'reflect-unknown-target': route(`${frame}Reflect.apply((()=>{}) as any,stream,[])`),
  'shadowed-reflect': route(
    `${frame}const Reflect={apply(_target:unknown,_receiver:unknown,_args:unknown[]){}};Reflect.apply(stream.write,stream,['raw'])`,
  ),
  'selected-replacement': route(`stream.write=(_value:string)=>{};${frame}`),
  'source-replacement': `${preamble}stream.write=(_value:string)=>{};app.route('/events').get(()=>{${frame}})`,
  'uncalled-source-replacement': `${preamble}function replace(){stream.write=(_value:string)=>{}};app.route('/events').get(()=>{${frame}})`,
  'called-helper-replacement': `${preamble}function replace(){stream.write=(_value:string)=>{}};app.route('/events').get(()=>{replace();${frame}})`,
  'called-helper-suffix': `${preamble}function replace(){stream.write=(_value:string)=>{}};app.route('/events').get(()=>{replace();${frame}${frame}})`,
  'called-helper-parameter-replacement': `${preamble}function replace(target:typeof stream){target.write=(_value:string)=>{}};app.route('/events').get(()=>{replace(stream);${frame}})`,
  'named-handler-called-helper': `${preamble}function replace(){stream.write=(_value:string)=>{}};function handle(){replace();${frame}};app.route('/events').get(handle)`,
  'opaque-callback-replacement': route(`opaque(()=>{stream.write=(_value:string)=>{}});${frame}`),
  'opaque-callback-suffix': route(
    `opaque(()=>{stream.write=(_value:string)=>{}});${frame}${frame}`,
  ),
  'opaque-callback-end-replacement': route(
    `opaque(()=>{delete (stream as {end?: (value?:unknown)=>void}).end});${frame}`,
  ),
  'opaque-source-callback-replacement': `${preamble}opaque(()=>{stream.write=(_value:string)=>{}});app.route('/events').get(()=>{${frame}})`,
  'ignored-callback-replacement': route(
    `function ignore(callback:()=>void){};ignore(()=>{stream.write=(_value:string)=>{}});${frame}`,
  ),
  'called-helper-other-stream-replacement': `${preamble}function replace(){other.write=(_value:string)=>{}};app.route('/events').get(()=>{replace();${frame}})`,
  'selected-computed-replacement': route(`stream['write']=(_value:string)=>{};${frame}`),
  'replacement-suffix': route(`stream.write=(_value:string)=>{};${frame}${frame}`),
  'selected-end-replacement': route(`stream.end=(_value?:unknown)=>{};${frame}`),
  'selected-delete': route(`delete (stream as {write?: (value:string)=>void}).write;${frame}`),
  'unrelated-delete': route(`delete (stream as {debug?: (value:string)=>void}).debug;${frame}`),
  'unknown-replacement-receiver': route(`getStream().write=(_value:string)=>{};${frame}`),
  'other-replacement': route(`other.write=(_value:string)=>{};${frame}`),
  'dead-replacement': route(`if(false)stream.write=(_value:string)=>{};${frame}`),
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
  'reflect',
  'reflect-unknown-payload',
  'reflect-pipe',
  'reflect-unknown-target',
  'selected-replacement',
  'source-replacement',
  'selected-computed-replacement',
  'selected-end-replacement',
  'selected-delete',
  'called-helper-replacement',
  'called-helper-suffix',
  'called-helper-parameter-replacement',
  'named-handler-called-helper',
  'opaque-callback-replacement',
  'opaque-callback-suffix',
  'opaque-callback-end-replacement',
  'opaque-source-callback-replacement',
  'unknown-replacement-receiver',
] as const)('rejects unrepresented output from %s', (name) => {
  expect(() => discover(name)).toThrow('unmarked frame')
  expect(discover(name, ['GET:/events'], true)['GET:/events']?.unavailableReason).toContain(
    'unmarked frame',
  )
})

it('invalidates an exact generated protocol row for Reflect.apply output', () => {
  const key = 'GET:/events#protocol-2'
  expect(discover('reflect-suffix', [key], true)[key]?.unavailableReason).toContain(
    'unmarked frame',
  )
  expect(discover('replacement-suffix', [key], true)[key]?.unavailableReason).toContain(
    'unmarked frame',
  )
  expect(discover('called-helper-suffix', [key], true)[key]?.unavailableReason).toContain(
    'unmarked frame',
  )
  expect(discover('opaque-callback-suffix', [key], true)[key]?.unavailableReason).toContain(
    'unmarked frame',
  )
})

it.each([
  'shadowed-reflect',
  'reflect-cleanup',
  'reflect-empty-write',
  'other-replacement',
  'dead-replacement',
  'unrelated-delete',
  'uncalled-source-replacement',
  'called-helper-other-stream-replacement',
  'ignored-callback-replacement',
] as const)('preserves the selected frame in %s', (name) => {
  expect(discover(name)['GET:/events']?.unavailableReason).toBeUndefined()
})
