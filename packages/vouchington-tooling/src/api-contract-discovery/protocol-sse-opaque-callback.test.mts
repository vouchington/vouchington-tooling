import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;class Stream{write(_value:string):void{}end(_value?:string):void{}}const stream=new Stream();
  const other=new Stream();declare function opaque(callback:any):void;
  declare function opaqueWriter(destination:typeof stream):void;
  declare const service:{write(value:typeof stream):void;end(value:typeof stream):void;consume(value:typeof stream):void};
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
  'opaque-stream-argument': route(`opaqueWriter(stream)`),
  'opaque-stream-alias': route(`const destination=stream;opaqueWriter(destination)`),
  'foreign-write-argument': route(`service.write(stream)`),
  'foreign-end-argument': route(`service.end(stream)`),
  'opaque-property-argument': route(`service.consume(stream)`),
  'opaque-bound-argument': route(`const emit=opaqueWriter.bind(undefined,stream);emit()`),
  'forwarded-opaque-argument': route(
    `function relay(destination:typeof stream){opaqueWriter(destination)}relay(stream)`,
  ),
  'implemented-stream-argument': route(
    `function ignore(destination:typeof stream){}ignore(stream)`,
  ),
  'implemented-typed-arrow-stream-argument': route(
    `const ignore:(destination:typeof stream)=>void=()=>{};ignore(stream)`,
  ),
  'other-stream-argument': route(`opaqueWriter(other)`),
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
const nodeSources = {
  'node-pipeline': `import { PassThrough, Readable, pipeline } from 'node:stream';
    declare const app:any;declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
    const stream=new PassThrough();const source=Readable.from(['raw']);
    app.route('/events').get(()=>{stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));pipeline(source,stream,()=>{})})`,
  'node-pipeline-suffix': `import { PassThrough, Readable, pipeline } from 'node:stream';
    declare const app:any;declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
    const stream=new PassThrough();const source=Readable.from(['raw']);
    app.route('/events').get(()=>{stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));pipeline(source,stream,()=>{})})`,
  'node-pipeline-dead': `import { PassThrough, Readable, pipeline } from 'node:stream';
    declare const app:any;declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
    const stream=new PassThrough();const source=Readable.from(['raw']);
    app.route('/events').get(()=>{stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));if(false)pipeline(source,stream,()=>{})})`,
  'node-pipeline-other-destination': `import { PassThrough, Readable, pipeline } from 'node:stream';
    declare const app:any;declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
    const stream=new PassThrough();const other=new PassThrough();const source=new PassThrough();
    app.route('/events').get(()=>{stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));pipeline(source,other,()=>{})})`,
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
let nodeProgram: ts.Program
let nodeFiles: Record<keyof typeof nodeSources, string>
let nodeRoot: string
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  nodeRoot = mkdtempSync(
    join(
      process.cwd(),
      'packages/vouchington-tooling/src/api-contract-discovery/.node-stream-fixtures-',
    ),
  )
  nodeFiles = Object.fromEntries(
    Object.entries(nodeSources).map(([name, source]) => {
      const file = join(nodeRoot, `${name}.ts`)
      writeFileSync(file, `${source}\nexport {}\n`)
      return [name, file]
    }),
  ) as Record<keyof typeof nodeSources, string>
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    typeRoots: [join(process.cwd(), 'node_modules/@types')],
    types: ['node'],
  }
  nodeProgram = ts.createProgram(Object.values(nodeFiles), options)
  expect(ts.getPreEmitDiagnostics(nodeProgram)).toEqual([])
})
afterAll(() => {
  if (nodeRoot) rmSync(nodeRoot, { recursive: true, force: true })
})
type SourceName = keyof typeof sources | keyof typeof nodeSources
const isNodeSource = (name: SourceName): name is keyof typeof nodeSources => name in nodeFiles
const sourceFile = (name: SourceName) =>
  isNodeSource(name)
    ? nodeProgram.getSourceFile(nodeFiles[name])!
    : matrix.sourceFile(name as keyof typeof sources)
const discover = (name: SourceName, keys?: readonly string[], lenient = false) =>
  discoverApiResponseContracts(
    isNodeSource(name) ? nodeProgram : matrix.program,
    [sourceFile(name)],
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
  'opaque-stream-argument',
  'opaque-stream-alias',
  'forwarded-opaque-argument',
  'foreign-write-argument',
  'foreign-end-argument',
  'opaque-property-argument',
  'opaque-bound-argument',
  'node-pipeline',
  'node-pipeline-suffix',
  'generator',
] as const)('rejects opaque raw emission in %s', (name) => {
  expect(() => discover(name)).toThrow('unmarked frame')
  const contracts = discover(name, undefined, true)
  expect(Object.keys(contracts)).toHaveLength(
    name === 'siblings' || name === 'node-pipeline-suffix' ? 2 : 1,
  )
  expect(
    Object.values(contracts).every((row) => row.unavailableReason?.includes('unmarked frame')),
  ).toBe(true)
})
it('preserves the exact selected suffix failure', () => {
  const key = 'GET:/events#protocol-2'
  const contracts = discover('siblings', [key], true)
  expect(Object.keys(contracts)).toEqual([key])
  expect(contracts[key]?.unavailableReason).toContain('unmarked frame')
  const pipelineContracts = discover('node-pipeline-suffix', [key], true)
  expect(Object.keys(pipelineContracts)).toEqual([key])
  expect(pipelineContracts[key]?.unavailableReason).toContain('unmarked frame')
})
it.each([
  'dead',
  'after-return',
  'unused',
  'outer-unused',
  'ignored',
  'ignored-options',
  'different',
  'cleanup',
  'implemented-stream-argument',
  'implemented-typed-arrow-stream-argument',
  'other-stream-argument',
  'node-pipeline-dead',
  'node-pipeline-other-destination',
] as const)('keeps the framed contract in %s', (name) => {
  const contracts = discover(name)
  expect(Object.keys(contracts)).toEqual(['GET:/events'])
  expect(contracts['GET:/events']?.unavailableReason).toBeUndefined()
})
