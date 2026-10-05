import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { nodePassThroughUnmodified } from './protocol-sse-node-constructor.mts'
import {
  buildVirtualProgramMatrix,
  COLD_VIRTUAL_PROGRAM_TIMEOUT_MS,
  type VirtualProgramMatrix,
} from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;class Stream{destroyed=false;writableEnded=false;write(value:string):void{};end(value?:string):void{}}
  declare function opaque(value:unknown):void;
  declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{
  const stream=new Stream();const other=new Stream();${body};
  stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))
})`
const sources = {
  cleanup: route(
    'function stopStream(){if(!stream.destroyed&&!stream.writableEnded)stream.end()}opaque(stopStream)',
  ),
  'cleanup-alias': route(
    'const selected=stream;const stopStream=()=>{if(!selected.destroyed)selected.end(undefined)};opaque(stopStream)',
  ),
  'raw-cleanup': route(
    "function stopStream(){if(!stream.destroyed)stream.end('raw')}opaque(stopStream)",
  ),
  'member-export': route(
    'const expose=(box:{value?:unknown})=>{box.value=stream.end};opaque(expose)',
  ),
  sideeffect: route('const expose=(box:{value?:Stream})=>{box.value=stream};opaque(expose)'),
  alias: route(
    'const selected=stream;const expose=(box:{value?:Stream})=>{box.value=selected};opaque(expose)',
  ),
  named: route('function expose(box:{value?:Stream}){box.value=stream}opaque(expose)'),
  shorthand: route('const expose=(box:{value?:unknown})=>{box.value={stream}};opaque(expose)'),
  'shorthand-other': route(
    'const expose=(box:{value?:unknown})=>{box.value={other}};opaque(expose)',
  ),
  'shorthand-parameter': route(
    'const expose=(box:{value?:unknown})=>{box.value={box}};opaque(expose)',
  ),
  'shorthand-function': route(
    'const expose=(box:{value?:unknown})=>{function noop(){};box.value={noop}};opaque(expose)',
  ),
  separate: route('const expose=(box:{value?:Stream})=>{box.value=other};opaque(expose)'),
  empty: route('const expose=()=>{};opaque(expose)'),
  primitive: route(
    'const label="safe";const expose=(box:{value?:string})=>{box.value=label};opaque(expose)',
  ),
} as const
const nodePreamble = `import {PassThrough} from 'node:stream';
  import {createRequire,syncBuiltinESMExports} from 'node:module';
  declare const app:any;const prior=new PassThrough();
  class Replacement extends PassThrough{constructor(){super();return prior}}
  declare function opaque(value:unknown):void;
  declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;`
const nodeRoute = `app.route('/events').get(()=>{opaque(prior);const stream=new PassThrough();
  stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))})`
const nodeSources = {
  define: [
    `${nodePreamble}Object.defineProperty(createRequire(import.meta.url)('node:stream'),
    'PassThrough',{value:Replacement});syncBuiltinESMExports();${nodeRoute}`,
    false,
  ],
  reflect: [
    `${nodePreamble}Reflect.set(createRequire(import.meta.url)('node:stream'),
    'PassThrough',Replacement);syncBuiltinESMExports();${nodeRoute}`,
    false,
  ],
  assign: [
    `${nodePreamble}Object.assign(createRequire(import.meta.url)('node:stream'),
    {PassThrough:Replacement});syncBuiltinESMExports();${nodeRoute}`,
    false,
  ],
  metadata: [
    `${nodePreamble}Object.defineProperty(createRequire(import.meta.url)('node:stream'),
    'label',{value:'safe'});syncBuiltinESMExports();${nodeRoute}`,
    true,
  ],
  normal: [`${nodePreamble}${nodeRoute}`, true],
  'primitive-import': [
    `import {sep} from 'node:path';${nodePreamble}
    app.route('/events').get(()=>{const stream=new PassThrough();
      const expose=(box:{value?:{sep:string}})=>{box.value={sep}};opaque(expose);
      stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))})`,
    true,
  ],
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
let root: string
let programs: Record<keyof typeof nodeSources, ts.Program>
let files: Record<keyof typeof nodeSources, string>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  root = mkdtempSync(join(tmpdir(), 'sse-captured-export-'))
  const directory = dirname(fileURLToPath(import.meta.url))
  files = Object.fromEntries(
    Object.entries(nodeSources).map(([name, [source]]) => {
      const file = join(root, `${name}.mts`)
      writeFileSync(file, source)
      return [name, file]
    }),
  ) as Record<keyof typeof nodeSources, string>
  programs = Object.fromEntries(
    Object.entries(files).map(([name, file]) => {
      const program = ts.createProgram([file], {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ESNext,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        typeRoots: [join(directory, '../../../../node_modules/@types')],
        types: ['node'],
      })
      expect(ts.getPreEmitDiagnostics(program)).toEqual([])
      return [name, program]
    }),
  ) as Record<keyof typeof nodeSources, ts.Program>
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
afterAll(() => rmSync(root, { recursive: true, force: true }))
const discover = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']
it.each(['sideeffect', 'alias', 'named', 'shorthand', 'raw-cleanup', 'member-export'] as const)(
  'rejects captured stream export in %s',
  (name) => {
    expect(discover(name)?.unavailableReason).toBe('SSE route writes an unmarked frame')
  },
)
it.each([
  'cleanup',
  'cleanup-alias',
  'separate',
  'empty',
  'primitive',
  'shorthand-other',
  'shorthand-parameter',
  'shorthand-function',
] as const)('preserves independent callback in %s', (name) => {
  expect(discover(name)?.unavailableReason).toBeUndefined()
})
it.each(Object.keys(nodeSources) as (keyof typeof nodeSources)[])(
  'checks reflective Node export provenance in %s',
  (name) => {
    const program = programs[name],
      source = program.getSourceFile(files[name])!
    const contracts = discoverApiResponseContracts(program, [source], undefined, {
      onRouteError: () => {},
    })
    expect(contracts['GET:/events']?.unavailableReason === undefined).toBe(nodeSources[name][1])
    expect(nodePassThroughUnmodified(source, program.getTypeChecker())).toBe(nodeSources[name][1])
    expect(nodePassThroughUnmodified(source, program.getTypeChecker())).toBe(nodeSources[name][1])
  },
)
