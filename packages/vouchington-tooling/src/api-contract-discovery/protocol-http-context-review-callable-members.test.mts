import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function checkedProgram(files: Record<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  }
  const contents = new Map(Object.entries(files).map(([name, text]) => [`/virtual/${name}`, text]))
  const host = ts.createCompilerHost(options, true)
  const getSourceFile = host.getSourceFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const directoryExists = host.directoryExists?.bind(host)
  const readFile = host.readFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, createNew) => {
    const text = contents.get(name)
    return text === undefined
      ? getSourceFile(name, languageVersion, onError, createNew)
      : ts.createSourceFile(name, text, languageVersion, true)
  }
  host.fileExists = (name) => contents.has(name) || fileExists(name)
  host.directoryExists = (name) => name === '/virtual' || !!directoryExists?.(name)
  host.readFile = (name) => contents.get(name) ?? readFile(name)
  const program = ts.createProgram([...contents.keys()], options, host)
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([])
  return program
}

function contract(files: Record<string, string>) {
  const program = checkedProgram(files)
  const source = program.getSourceFile('/virtual/route.ts')
  if (!source) throw new Error('Missing route source')
  return discoverApiResponseContracts(program, [source], new Set(['PUT:/vote']))['PUT:/vote']
}

function expectUnknown(files: Record<string, string>): void {
  const row = contract(files)
  expect(row?.statusKnowledge).toBe('unknown')
  expect(row?.unavailableReason).toBeTruthy()
}

function expectNoContent(files: Record<string, string>): void {
  const row = contract(files)
  expect(row?.unavailableReason).toBeUndefined()
  expect(responseStatusCodesForContract(row!)).toEqual([204])
}

const preamble = `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare function opaque(value:any):void;
  type Context={params:{id:string};assert(value:boolean):void;json(value:any):void;setStatus(status:number):void};
  type Options={assertAccess?:(ctx:Context)=>void};
  function factory(options:Options){return(ctx:Context)=>{
    if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}`

const route = (setup: string, selected = 'options') => `${preamble}
  ${setup}
  app.route('/vote').put((ctx:Context)=>{
    apiNoContent('PUT:/vote');factory(${selected})(ctx)});export {};`

const controls = {
  methodReturn: 'opaque({expose(){return ctx}})',
  methodEmit: 'opaque({emit(){ctx.json({bad:true})}})',
  methodForward: 'opaque({emit(){opaque(ctx)}})',
  getterReturn: 'opaque({get exposed(){return ctx}})',
  getterEmit: 'opaque({get exposed(){ctx.json({bad:true});return 1}})',
  arrowReturn: 'opaque({expose:()=>ctx})',
  nestedReturn: 'opaque([{expose(){return ctx}}])',
  independent: 'opaque({expose(){return {independent:true}}})',
  unused: 'const wrapper={expose(){return ctx}};ctx.assert(true)',
  ignored: 'function ignore(_wrapper:unknown){};ignore({expose(){return ctx}})',
  readonly: 'opaque({check(){ctx.assert(true)}})',
  getterReadonly: 'opaque({get check(){ctx.assert(true);return 1}})',
  dead: 'opaque({emit(){if(false)ctx.json({bad:true});ctx.assert(true)}})',
} as const
const fixture = (name: keyof typeof controls) => ({
  'route.ts': route(`const options={assertAccess:(ctx:Context)=>{${controls[name]}}};`),
})
it.each([
  'methodReturn',
  'methodEmit',
  'methodForward',
  'getterReturn',
  'getterEmit',
  'arrowReturn',
  'nestedReturn',
] as const)('rejects selected callable literal member %s', (name) => expectUnknown(fixture(name)))
it.each(['independent', 'unused', 'ignored', 'readonly', 'getterReadonly', 'dead'] as const)(
  'retains independent or ignored literal member %s',
  (name) => expectNoContent(fixture(name)),
)
