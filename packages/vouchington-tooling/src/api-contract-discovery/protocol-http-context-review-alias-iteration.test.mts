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

const unsafe = {
  object: 'const wrapper={context:ctx};opaque(wrapper)',
  array: 'const wrapper=[ctx];opaque(wrapper)',
  method: 'const wrapper={expose(){return ctx}};opaque(wrapper)',
  nested: 'const wrapper=[{expose(){ctx.json({bad:true})}}];opaque(wrapper)',
  iteration: 'for(const saved of [ctx])opaque(saved)',
  wrappedIteration: 'for(const saved of [{context:ctx}])opaque(saved)',
} as const
const safe = {
  independent: 'const wrapper={context:{independent:true}};opaque(wrapper)',
  ignored: 'function ignore(_value:unknown){};const wrapper={context:ctx};ignore(wrapper)',
  readonly: 'const wrapper={check(){ctx.assert(true)}};opaque(wrapper)',
  unused: 'const wrapper={context:ctx};ctx.assert(true)',
  dead: 'const wrapper={context:ctx};if(false)opaque(wrapper)',
  independentIteration: 'for(const saved of [{independent:true}])opaque(saved)',
  deadIteration: 'if(false){for(const saved of [ctx])opaque(saved)}',
} as const
it.each(Object.entries(unsafe))('rejects selected alias or iteration %s', (_name, body) => {
  expectUnknown({ 'route.ts': route(`const options={assertAccess:(ctx:Context)=>{${body}}};`) })
})
it.each(Object.entries(safe))('retains independent, ignored or dead alias %s', (_name, body) => {
  expectNoContent({ 'route.ts': route(`const options={assertAccess:(ctx:Context)=>{${body}}};`) })
})
