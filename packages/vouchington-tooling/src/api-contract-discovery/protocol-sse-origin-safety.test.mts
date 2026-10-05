import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'

const preamble = `import {PassThrough} from 'node:stream';declare const app:any;
  declare function opaque(value:unknown):void;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  type Owner={stream:PassThrough};
  function startSSE():Owner{const stream=new PassThrough();return {stream}}
  `
const frame = (stream: string) =>
  `${stream}.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const route = (body: string) => `${preamble}app.route('/events').get(()=>{${body}})`
const replacedTimer = (replacement: string) => `${preamble}
  let selected:PassThrough|undefined;
  ${replacement}
  function borrowed():Owner{return {stream:selected!}}
  app.route('/events').get(()=>{selected=new PassThrough();
    const interval=setInterval(()=>{},2000);const {stream}=borrowed();
    opaque(interval);${frame('stream')}})`
const replacement = `(()=>selected) as unknown as typeof setInterval`
const cases = {
  'factory-metadata': [
    route(`(startSSE as typeof startSSE & {label?:string}).label='factory';const before:unknown={id:'id'};
    opaque(before);const {stream}=startSSE();${frame('stream')}`),
    true,
  ],
  'factory-control': [
    route(`const before:unknown={id:'id'};
    opaque(before);const {stream}=startSSE();${frame('stream')}`),
    true,
  ],
  'factory-computed-metadata': [
    route(`let label:string|undefined;
    ({[startSSE.name]:label}={[startSSE.name]:'factory'});
    const before:unknown={id:label};opaque(before);
    const {stream}=startSSE();${frame('stream')}`),
    true,
  ],
  'define-property-timer': [
    replacedTimer(`Object.defineProperty(globalThis,'setInterval',{value:${replacement}});`),
    false,
  ],
  'reflect-set-timer': [
    replacedTimer(`Reflect.set(globalThis,'setInterval',${replacement});`),
    false,
  ],
  'assign-global-timer': [
    replacedTimer(`Object.assign(globalThis,{setInterval:${replacement}});`),
    false,
  ],
  'unrelated-reflective-metadata': [
    route(`Object.assign(globalThis,{metadata:true});
    const {stream}=startSSE();const interval=setInterval(()=>{},2000);
    opaque(interval);${frame('stream')}`),
    true,
  ],
  'ambient-stream-alias': [
    `${preamble}
    declare const stream:PassThrough;declare const other:typeof stream;
    app.route('/events').get(()=>{opaque(other);${frame('stream')}})`,
    false,
  ],
  'ambient-any-alias': [
    `${preamble}
    declare const stream:PassThrough;declare const other:any;
    app.route('/events').get(()=>{opaque(other);${frame('stream')}})`,
    false,
  ],
  'pipeline-unproven-source': [
    `${preamble}
    import {Readable,pipeline} from 'node:stream';
    app.route('/events').get(()=>{const stream=new PassThrough();
      const other=new PassThrough();const source=Readable.from(['raw']);
      pipeline(source,other,()=>{});${frame('stream')}})`,
    false,
  ],
  'timer-stream-overlap': [
    route(`const interval=setInterval(()=>{},2000);
    const stream:{write(value:string):void}=Object.assign(interval,{write(_value:string){}});
    opaque(interval);${frame('stream')}`),
    false,
  ],
  'conditional-selected-stream': [
    route(`const interval=setInterval(()=>{},2000);const stream=new PassThrough();
    const alias=Math.random()>0.5?interval:stream;opaque(alias);${frame('stream')}`),
    false,
  ],
  'timer-independent-fresh-stream': [
    route(`const interval=setInterval(()=>{},2000);
    const stream=new PassThrough();opaque(interval);${frame('stream')}`),
    true,
  ],
} as const
let root: string
let programs: Record<keyof typeof cases, ts.Program>
let paths: Record<keyof typeof cases, string>
beforeAll(() => {
  const directory = dirname(fileURLToPath(import.meta.url))
  root = mkdtempSync(join(directory, '.sse-origin-proof-'))
  paths = Object.fromEntries(
    Object.entries(cases).map(([name, [source]]) => {
      const file = join(root, `${name}.ts`)
      writeFileSync(file, source)
      return [name, file]
    }),
  ) as Record<keyof typeof cases, string>
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    typeRoots: [join(directory, '../../../../node_modules/@types')],
    types: ['node'],
  }
  // Each program isolates global timer mutations from the untouched timer controls.
  programs = Object.fromEntries(
    Object.entries(paths).map(([name, file]) => {
      const program = ts.createProgram([file], options)
      expect(
        ts
          .getPreEmitDiagnostics(program)
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
      ).toEqual([])
      return [name, program]
    }),
  ) as Record<keyof typeof cases, ts.Program>
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
afterAll(() => rmSync(root, { recursive: true, force: true }))
it.each(Object.keys(cases) as (keyof typeof cases)[])(
  'checks actual stream origins in %s',
  (name) => {
    const program = programs[name]
    const discover = () =>
      discoverApiResponseContracts(program, [program.getSourceFile(paths[name])!])
    if (cases[name][1]) expect(discover()['GET:/events']?.unavailableReason).toBeUndefined()
    else expect(discover).toThrow('unmarked frame')
  },
)
