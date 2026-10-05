import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'

const preamble = `import {data,aggregate,ignore,raw,apiSseFrame} from './foreign';
  declare const app:any; declare function opaqueProducer(value:unknown):unknown;
  class Stream {write(_value:string):void{}}
  declare const alternative:Stream|undefined;
  function startSSE(){return {stream:new Stream()}}
`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{
  const {stream}=startSSE();${body};stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))
})`
const sources = {
  data: route("const queues=data(['one']);const stats=aggregate(queues);ignore(stats)"),
  cycle: route('var cyclic:unknown[]|undefined=[cyclic];ignore(cyclic)'),
  'opaque-selected': route('opaqueProducer(stream)'),
  'nullish-selected-right': route('raw(alternative??stream)'),
  'or-selected-right': route('raw(alternative||stream)'),
  'and-selected-right': route('raw(alternative&&stream)'),
  'nullish-selected-left': route('raw(stream??alternative)'),
  'conditional-selected-alias': route('const alias=Math.random()>0.5?stream:undefined;raw(alias)'),
  'assigned-selected-alias': route(
    "let alias;alias=stream;const queues=data(['one']);aggregate(queues)",
  ),
  'concrete-selected-raw': route('raw(stream)'),
  'concrete-selected-ignore': route('ignore(stream)'),
  'concrete-closure-ignore': route('ignore(()=>stream)'),
  'stored-global': route(
    ";(globalThis as any).saved=stream;const queues=data(['one']);aggregate(queues)",
  ),
  'literal-container-selected': route('raw({output:stream})'),
  'captured-selected': route('opaqueProducer(()=>opaqueProducer(stream))'),
  'returned-selected': route('opaqueProducer(()=>stream)'),
  foreign: `export function apiSseFrame<K extends string,const T>(_key:K,event:T):string{return JSON.stringify(event)}
    export function data(names:string[]){return names.map(name=>({name}))}
    export function aggregate(values:{name:string}[]){return values.reduce((n,value)=>n+value.name.length,0)}
    export function ignore(_value:unknown){}
    export function raw(value:any){(value.output??value).write('raw')}`,
} as const
let root: string
let program: ts.Program
let paths: Record<keyof typeof sources, string>
beforeAll(() => {
  root = mkdtempSync(join(process.cwd(), 'packages/vouchington-tooling/.sse-origin-fixtures-'))
  paths = Object.fromEntries(
    Object.entries(sources).map(([name, source]) => {
      const path = join(root, `${name}.ts`)
      writeFileSync(path, `${source}\nexport {}\n`)
      return [name, path]
    }),
  ) as Record<keyof typeof sources, string>
  program = ts.createProgram(Object.values(paths), {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  })
  expect(ts.getPreEmitDiagnostics(program).map((diagnostic) => diagnostic.code)).toEqual([])
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})
const discover = (name: keyof typeof sources) =>
  discoverApiResponseContracts(program, [program.getSourceFile(paths[name])!], undefined, {
    onRouteError: () => {},
  })['GET:/events']
it.each(['data', 'cycle', 'concrete-selected-ignore', 'concrete-closure-ignore'] as const)(
  'preserves the actual imported body proof in %s',
  (name) => expect(discover(name)?.unavailableReason).toBeUndefined(),
)
it.each([
  'opaque-selected',
  'nullish-selected-right',
  'or-selected-right',
  'and-selected-right',
  'nullish-selected-left',
  'conditional-selected-alias',
  'assigned-selected-alias',
  'concrete-selected-raw',
  'stored-global',
  'literal-container-selected',
  'captured-selected',
  'returned-selected',
] as const)('rejects the observable selected capability in %s', (name) =>
  expect(discover(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
