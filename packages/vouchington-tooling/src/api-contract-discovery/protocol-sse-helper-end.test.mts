import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  declare const stream:{write(value:string):void;end(value?:unknown):void};
  declare const other:typeof stream;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{${frame}${body}})`
const helper = `function raw(output:typeof stream){output.write('raw')}`
const sources = {
  global: `${preamble}${helper}app.route('/events').get(()=>{${frame}raw(stream)})`,
  shared: `${preamble}${helper}app.route('/events').get(()=>{${frame}raw(stream)});app.route('/other').get(()=>raw(other))`,
  'shared-other': `${preamble}${helper}app.route('/events').get(()=>{${frame}raw(other)});app.route('/other').get(()=>raw(stream))`,
  default: route(`function raw(output:typeof stream=stream){output.write('raw')}raw()`),
  recursive: route(
    `function raw(output:typeof stream){if(Math.random()>0.5)raw(output);output.write('raw')}raw(stream)`,
  ),
  unknown: `${preamble}declare function getStream():typeof stream;${helper}app.route('/events').get(()=>{${frame}raw(getStream())})`,
  'handler-param': `${preamble}app.route('/events').get((ctx:{stream:typeof stream})=>{${frame.replace('stream.write', 'ctx.stream.write')}ctx.stream.write('raw')})`,
  'framed-helper': `${preamble}function emit(output:typeof stream){output.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))}app.route('/events').get(()=>{emit(stream);stream.write('raw')})`,
  computed: route(`const outputs=[stream];outputs[0]!.write('raw')`),
  wrapper: route(
    `const source={stream};function raw(output:typeof source){output.stream.write('raw')}raw(source)`,
  ),
  erased: route(`function raw(this:void,output:typeof stream){output.write('raw')}raw(stream)`),
  'mutable-alias': route(`let output:typeof stream=other;output=stream;output.write('raw')`),
  'assigned-alias': route(`let output:typeof stream;output=stream;output.write('raw')`),
  'mutable-argument': route(`${helper}let output=other;output=stream;raw(output)`),
  'mutated-parameter': route(
    `function raw(output:typeof stream){output=stream;output.write('raw')}raw(other)`,
  ),
  local: route(`${helper}raw(stream)`),
  nested: route(`${helper}function relay(output:typeof stream){raw(output)}relay(stream)`),
  'global-log': route('') + `;other.write('log')`,
  other: route(`${helper}raw(other)`),
  unused: route(helper),
  dead: route(`${helper}if(false)raw(stream)`),
  'after-return': route(`${helper}return;raw(stream)`),
  'end-string': route(`stream.end('raw')`),
  'end-bytes': route(`stream.end(new Uint8Array([1]))`),
  'end-empty': route(`stream.end()`),
  'end-undefined': route(`stream.end(undefined)`),
  'end-null': route(`stream.end(null)`),
  'end-callback': route(`stream.end(()=>{})`),
  'end-other': route(`other.end('log')`),
  'end-helper': route(`function end(output:typeof stream){output.end('raw')}end(stream)`),
  'end-helper-other': route(`function end(output:typeof stream){output.end('log')}end(other)`),
  'bracket-write': route(`stream['write']('raw')`),
  'bracket-end': route(`stream['end']('raw')`),
  'bracket-template': route('stream[`write`](`raw`)'),
  'bracket-wrapped': route(`stream[('write' as const)]('raw')`),
  'bracket-helper': route(`function raw(output:typeof stream){output['write']('raw')}raw(stream)`),
  'bracket-dynamic': route(`const method=Math.random()>0.5?'write':'end';stream[method]('raw')`),
  'bracket-empty-end': route(`stream['end']()`),
  'bracket-callback-end': route(`stream['end'](()=>{})`),
  'bracket-other': route(`other['write']('log')`),
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
  'global',
  'mutable-alias',
  'assigned-alias',
  'mutable-argument',
  'mutated-parameter',
  'computed',
  'handler-param',
  'framed-helper',
  'wrapper',
  'erased',
  'shared',
  'default',
  'recursive',
  'unknown',
  'local',
  'nested',
  'end-string',
  'end-bytes',
  'end-helper',
  'bracket-write',
  'bracket-end',
  'bracket-template',
  'bracket-wrapped',
  'bracket-helper',
  'bracket-dynamic',
] as const)('rejects extra bytes in %s', (name) => {
  expect(() => discover(name)).toThrow('unmarked frame')
  expect(discover(name, true)['GET:/events']?.unavailableReason).toContain('unmarked frame')
})
it.each([
  'other',
  'global-log',
  'shared-other',
  'unused',
  'dead',
  'after-return',
  'end-empty',
  'end-undefined',
  'end-null',
  'end-callback',
  'end-other',
  'end-helper-other',
  'bracket-empty-end',
  'bracket-callback-end',
  'bracket-other',
] as const)('preserves framed writes in %s', (name) => {
  const contracts = discover(name)
  expect(Object.keys(contracts)).toEqual(['GET:/events'])
  expect(contracts['GET:/events']?.unavailableReason).toBeUndefined()
})
