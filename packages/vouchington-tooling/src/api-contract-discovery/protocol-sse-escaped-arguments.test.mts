import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;class Stream{write(value:string):void{}}
  const stream=new Stream();const other=new Stream();
  declare function opaque(value:unknown):void;
  declare function opaqueTag(strings:TemplateStringsArray,...values:unknown[]):string;
  declare class Sink{constructor(value?:unknown)}
  declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{
  ${body};stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))
})`
const sources = {
  object: route('opaque({stream})'),
  tag: route('opaqueTag`value:${stream}`'),
  'tag-capture': route('opaqueTag`value:${()=>stream}`'),
  'tag-empty': route('opaqueTag`value`'),
  'tag-independent-capture': route('opaqueTag`value:${()=>other}`'),
  'tag-container': route('opaqueTag`value:${{stream}}`'),
  'tag-other': route('opaqueTag`value:${other}`'),
  'tag-dead': route('if(false)opaqueTag`value:${stream}`'),
  array: route('opaque([stream])'),
  'object-spread': route('opaque({...{stream}})'),
  'array-spread': route('opaque([...[stream]])'),
  nested: route('opaque({values:[{output:stream}]})'),
  parameter: route('function relay(stream:Stream){opaque({stream})}relay(stream)'),
  binding: route('const {stream:destination}={stream};opaque({destination})'),
  constructor: route('new Sink(stream)'),
  'constructor-object': route('new Sink({stream})'),
  imported: `import {raw} from './foreign';${route('raw(stream)')}`,
  'imported-ignore': `import {ignore} from './foreign';${route('ignore(stream)')}`,
  'object-other': route('opaque({stream:other})'),
  'array-other': route('opaque([other])'),
  'constructor-other': route('new Sink(other)'),
  'dead-constructor': route('if(false)new Sink(stream)'),
  'local-ignore': route('function ignore(value:Stream){}ignore(stream)'),
  'literal-method': route('opaque({ignore(){}})'),
  'omitted-array': route('opaque([,,other])'),
  'constructor-empty': route('new Sink'),
  foreign: `export function raw(stream:{write(value:string):void}){stream.write('raw')}
    export function ignore(stream:{write(value:string):void}){}`,
} as const
let program: ts.Program
let root: string
let files: Record<keyof typeof sources, string>
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sse-escape-fixtures-'))
  files = Object.fromEntries(
    Object.entries(sources).map(([name, source]) => {
      const file = join(root, `${name}.ts`)
      writeFileSync(file, `${source}\nexport {}\n`)
      return [name, file]
    }),
  ) as Record<keyof typeof sources, string>
  program = ts.createProgram(Object.values(files), {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  })
  expect(ts.getPreEmitDiagnostics(program)).toEqual([])
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})
const sourceFile = (name: keyof typeof sources) => program.getSourceFile(files[name])!
const discover = (name: keyof typeof sources, includeForeign = false) =>
  discoverApiResponseContracts(
    program,
    [sourceFile(name), ...(includeForeign ? [sourceFile('foreign')] : [])],
    undefined,
    { onRouteError: () => {} },
  )['GET:/events']

it.each([
  'tag',
  'tag-container',
  'tag-capture',
  'object',
  'array',
  'object-spread',
  'array-spread',
  'nested',
  'parameter',
  'binding',
  'constructor',
  'constructor-object',
  'imported',
] as const)('rejects the selected stream escape in %s', (name) =>
  expect(discover(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'tag-other',
  'tag-empty',
  'tag-independent-capture',
  'tag-dead',
  'object-other',
  'array-other',
  'constructor-other',
  'dead-constructor',
  'local-ignore',
  'imported-ignore',
  'literal-method',
  'omitted-array',
  'constructor-empty',
] as const)('preserves a proven separate or unused stream in %s', (name) =>
  expect(discover(name)?.unavailableReason).toBeUndefined(),
)
it('indexes the imported implementation only when its source is included', () => {
  expect(discover('imported-ignore', true)?.unavailableReason).toBeUndefined()
  expect(discover('imported', true)?.unavailableReason).toBe('SSE route writes an unmarked frame')
})
