import { describe, expect, it } from 'vitest'
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

describe('HTTP context proof follows module bindings and callback aliases', () => {
  it('rejects a destructured dynamic-import consumer write', () => {
    expectUnknown({
      'options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
      'consumer.ts': `declare const opaque:(ctx:any)=>void;
        import('./options.js').then(({options})=>{options.assertAccess=opaque});export {};`,
      'route.ts': `import {options as importedOptions} from './options.js';
        ${route('', 'importedOptions')}`,
    })
  })

  it('keeps an imported callback after a read-only destructured consumer', () => {
    expectNoContent({
      'options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
      'consumer.ts': `import('./options.js').then(({options})=>{
        void options.assertAccess});export {};`,
      'route.ts': `import {options as importedOptions} from './options.js';
        ${route('', 'importedOptions')}`,
    })
  })

  it('rejects an opaque escape of Reflect.getPrototypeOf capability', () => {
    expectUnknown({
      'route.ts': route(`opaque(Reflect.getPrototypeOf({}));const options:Options={};`),
    })
  })

  it('keeps an own concrete callback despite the same prototype escape', () => {
    expectNoContent({
      'route.ts': route(`opaque(Reflect.getPrototypeOf({}));
        const options={assertAccess:(ctx:Context)=>ctx.assert(true)};`),
    })
  })

  it('rejects a JSON emission through a rest-parameter alias', () => {
    expectUnknown({
      'route.ts': route(`const options={assertAccess:(...args:any[])=>{
        args[0].json({bad:true})}};`),
    })
  })

  it('rejects a JSON emission through the non-arrow arguments object', () => {
    expectUnknown({
      'route.ts': route(`const options={assertAccess:function(ctx:Context){
        arguments[0].json({bad:true})}};`),
    })
  })

  it('keeps an ordinary concrete callback at 204', () => {
    expectNoContent({
      'route.ts': route(`const options={assertAccess:(ctx:Context)=>ctx.assert(true)};`),
    })
  })

  it('rejects an opaque callee receiving a closure that captures the context', () => {
    expectUnknown({
      'route.ts': route(`const options={assertAccess:(ctx:Context)=>{
        opaque(()=>ctx.json({bad:true}))}};`),
    })
  })

  it('keeps a closure that reads only a primitive context member', () => {
    expectNoContent({
      'route.ts': route(`const options={assertAccess:(ctx:Context)=>{
        opaque(()=>ctx.params.id)}};`),
    })
  })
})
