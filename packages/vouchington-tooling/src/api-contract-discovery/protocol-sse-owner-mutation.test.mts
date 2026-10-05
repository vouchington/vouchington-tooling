import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  class Stream{write(_value:string):void{}}
  type Owner={stream:Stream};const prior=new Stream();
  function startSSE():Owner{const stream=new Stream();return {stream}}
  declare function opaque(value:unknown):void;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  `
const frame = (stream: string) =>
  `${stream}.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const route = (body: string) => `app.route('/events').get(()=>{${body}})`
const cases = {
  'script-global-replacement': [
    `${preamble}(globalThis as any).startSSE=()=>({stream:prior});
    ${route(`opaque(prior);const {stream}=startSSE();${frame('stream')}`)}`,
    false,
  ],
  'script-factory-metadata': [
    `${preamble}(startSSE as typeof startSSE & {label?:string}).label='factory';
    ${route(`opaque(prior);const {stream}=startSSE();${frame('stream')}`)}`,
    true,
  ],
  'script-global-bracket-replacement': [
    `${preamble}(globalThis as any)['startSSE']=()=>({stream:prior});
    ${route(`opaque(prior);const {stream}=startSSE();${frame('stream')}`)}`,
    false,
  ],
  'script-global-dynamic-replacement': [
    `${preamble}declare const key:string;
    (globalThis as any)[key]=()=>({stream:prior});
    ${route(`opaque(prior);const {stream}=startSSE();${frame('stream')}`)}`,
    false,
  ],
  'script-global-other-property': [
    `${preamble}(globalThis as any).metadata='factory';
    ${route(`opaque(prior);const {stream}=startSSE();${frame('stream')}`)}`,
    true,
  ],
  'array-binding-prototype-iterator': [
    `${preamble}export {};
    (Object.prototype as any)[Symbol.iterator]=function*(){yield prior};
    ${route(`opaque(prior);const [stream]=startSSE() as any;${frame('stream')}`)}`,
    false,
  ],
  'object-binding-control': [
    `${preamble}export {};
    ${route(`opaque(prior);const {stream}=startSSE();${frame('stream')}`)}`,
    true,
  ],
  'delete-selected-property': [
    `${preamble}export {};(Object.prototype as any).stream=prior;
    ${route(`let sse:Owner|undefined;opaque(prior);sse=startSSE();
      delete (sse as any).stream;${frame('sse.stream')}`)}`,
    false,
  ],
  'owner-property-control': [
    `${preamble}export {};
    ${route(`let sse:Owner|undefined;opaque(prior);sse=startSSE();${frame('sse.stream')}`)}`,
    true,
  ],
  'delete-unrelated-property': [
    `${preamble}export {};
    ${route(`const metadata:{label?:string}={label:'factory'};delete metadata.label;
      let sse:Owner|undefined;opaque(prior);sse=startSSE();${frame('sse.stream')}`)}`,
    true,
  ],
} as const
let root: string
let programs: Record<keyof typeof cases, ts.Program>
let files: Record<keyof typeof cases, string>
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sse-owner-mutations-'))
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    noEmit: true,
    types: [],
  }
  files = Object.fromEntries(
    Object.entries(cases).map(([name, [source]]) => {
      const file = join(root, `${name}.ts`)
      writeFileSync(file, source)
      return [name, file]
    }),
  ) as Record<keyof typeof cases, string>
  programs = Object.fromEntries(
    Object.entries(files).map(([name, file]) => {
      const program = ts.createProgram([file], options)
      expect(
        ts
          .getPreEmitDiagnostics(program)
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
      ).toEqual([])
      expect(ts.isExternalModule(program.getSourceFile(file)!)).toBe(!name.startsWith('script-'))
      return [name, program]
    }),
  ) as Record<keyof typeof cases, ts.Program>
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
afterAll(() => rmSync(root, { recursive: true, force: true }))
it.each(Object.keys(cases) as (keyof typeof cases)[])(
  'checks exact owner mutation semantics in %s',
  (name) => {
    const program = programs[name]
    const discover = () =>
      discoverApiResponseContracts(program, [program.getSourceFile(files[name])!])
    if (cases[name][1]) expect(discover()['GET:/events']?.unavailableReason).toBeUndefined()
    else expect(discover).toThrow('unmarked frame')
  },
)
