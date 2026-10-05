import { describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { contextModuleOrigin } from './protocol-http-context-module-origin.mts'

function checkedProgram(files: Record<string, string>) {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  }
  const texts = new Map(Object.entries(files).map(([name, text]) => [`/virtual/${name}`, text]))
  const host = ts.createCompilerHost(options, true)
  const originalSource = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, createNew) => {
    const content = texts.get(name)
    return content === undefined
      ? originalSource(name, languageVersion, onError, createNew)
      : ts.createSourceFile(name, content, languageVersion, true, ts.ScriptKind.TS)
  }
  const originalExists = host.fileExists.bind(host)
  host.fileExists = (name) => texts.has(name) || originalExists(name)
  const originalDirectory = host.directoryExists?.bind(host)
  host.directoryExists = (name) => name === '/virtual' || !!originalDirectory?.(name)
  const originalRead = host.readFile.bind(host)
  host.readFile = (name) => texts.get(name) ?? originalRead(name)
  const program = ts.createProgram([...texts.keys()], options, host)
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([])
  return program
}

function routeContract(program: ts.Program, routeFile: string, key: string) {
  const source = program.getSourceFile(`/virtual/${routeFile}`)
  if (!source) throw new Error(`Missing route fixture ${routeFile}`)
  return discoverApiResponseContracts(program, [source], new Set([key]))[key]
}

const wrapperPreamble = `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare const opaque:()=>void;
  type Options={assertAccess?:(ctx:any)=>void;mutate:()=>void};
  function factory(options:Options){return(ctx:any)=>{
    options.assertAccess?.(ctx);ctx.setStatus(204)}}`

const prototypeRoute = (mutation: string, options = '{}') => `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare function opaque(ctx:any):void;
  type Options={assertAccess?:(ctx:any)=>void};
  ${mutation}
  function factory(options:Options){return(ctx:any)=>{
    if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}
  app.route('/vote').put((ctx:any)=>{
    apiNoContent('PUT:/vote');factory(${options})(ctx)});export {};`

describe('HTTP context proof across wrappers, module loading, and prototypes', () => {
  it.each([
    [
      'object',
      'function consume(wrapper:{options:Options}){wrapper.options.mutate()}consume({options});',
    ],
    ['array', 'function consume(wrapper:Options[]){wrapper[0]!.mutate()}consume([options]);'],
  ] as const)('rejects an opaque receiver call through an %s wrapper', (_kind, consume) => {
    const program = checkedProgram({
      'route.ts': `${wrapperPreamble}
        const options={assertAccess:(ctx:any)=>ctx.assert(true),mutate:opaque};
        ${consume}
        app.route('/vote').put((ctx:any)=>{
          apiNoContent('PUT:/vote');factory(options)(ctx)});export {};`,
    })
    const row = routeContract(program, 'route.ts', 'PUT:/vote')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('retains a callback after a concrete receiver method is called', () => {
    const program = checkedProgram({
      'route.ts': `${wrapperPreamble}
        const options={assertAccess:(ctx:any)=>ctx.assert(true),mutate:()=>{}};
        function consume(wrapper:{options:Options}){wrapper.options.mutate()}
        consume({options});
        app.route('/vote').put((ctx:any)=>{
          apiNoContent('PUT:/vote');factory(options)(ctx)});export {};`,
    })
    const row = routeContract(program, 'route.ts', 'PUT:/vote')
    expect(row?.unavailableReason).toBeUndefined()
    expect(responseStatusCodesForContract(row!)).toEqual([204])
  })

  it('rejects an exported options object escaped through a dynamic module import', () => {
    const program = checkedProgram({
      'options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
      'consumer.ts': `declare function opaque(value:any):void;
        export async function consumer(){const module=await import('./options.js');opaque(module.options)}`,
      'route.ts': `import {options} from './options.js';
        declare const app:any;declare function apiNoContent(key:string):void;
        function factory(value:typeof options){return(ctx:any)=>{
          value.assertAccess(ctx);ctx.setStatus(204)}}
        app.route('/vote').put((ctx:any)=>{
          apiNoContent('PUT:/vote');factory(options)(ctx)});`,
    })
    const row = routeContract(program, 'route.ts', 'PUT:/vote')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('keeps a local options mutation visible through a value cast to a module namespace type', () => {
    const program = checkedProgram({
      'other-options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
      'route.ts': `declare const app:any;
        declare function apiNoContent(key:string):void;
        declare const opaque:()=>void;
        const localOptions={assertAccess:(ctx:any)=>ctx.assert(true)};
        const bucket={options:localOptions} as typeof import('./other-options.js');
        bucket.options.assertAccess=opaque;
        function factory(options:typeof localOptions){return(ctx:any)=>{
          options.assertAccess(ctx);ctx.setStatus(204)}}
        app.route('/vote').put((ctx:any)=>{
          apiNoContent('PUT:/vote');factory(localOptions)(ctx)});export {};`,
    })
    const row = routeContract(program, 'route.ts', 'PUT:/vote')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('recognizes awaited import origins and const aliases but not a pending import promise', () => {
    const program = checkedProgram({
      'options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
      'consumer.ts': `export async function consume(specifier:string){
        const pending=import('./options.js');
        const ready=await import('./options.js');
        const alias=ready;
        const dynamic=await import(specifier);
        return [pending,ready,alias,dynamic]}`,
    })
    const checker = program.getTypeChecker()
    const moduleSource = program.getSourceFile('/virtual/options.ts')
    const consumer = program
      .getSourceFile('/virtual/consumer.ts')
      ?.statements.find(ts.isFunctionDeclaration)
    if (!moduleSource || !consumer?.body) throw new Error('Missing module origin fixture')
    const module = checker.getSymbolAtLocation(moduleSource)
    if (!module) throw new Error('Missing module symbol')
    expect(checker.getExportsOfModule(module).map((item) => item.name)).toContain('options')
    const declarations = consumer.body.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
    const symbols = declarations.map((declaration) => checker.getSymbolAtLocation(declaration.name))
    expect(symbols).toHaveLength(4)
    expect(symbols.every(Boolean)).toBe(true)
    expect(contextModuleOrigin(checker, symbols[0])).toBeUndefined()
    expect(contextModuleOrigin(checker, symbols[1])).toBe(module)
    expect(contextModuleOrigin(checker, symbols[2])).toBe(module)
    expect(contextModuleOrigin(checker, symbols[3])).toBeUndefined()
  })

  it('retains 204 when an empty options object has no prototype mutation', () => {
    const program = checkedProgram({ 'route.ts': prototypeRoute('') })
    const row = routeContract(program, 'route.ts', 'PUT:/vote')
    expect(row?.unavailableReason).toBeUndefined()
    expect(responseStatusCodesForContract(row!)).toEqual([204])
  })

  it('rejects an optional callback supplied through a mutated object prototype', () => {
    const program = checkedProgram({
      'route.ts': prototypeRoute('(Object.prototype as any).assertAccess=opaque;'),
    })
    const row = routeContract(program, 'route.ts', 'PUT:/vote')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it.each([
    [
      'aliased Reflect.set',
      `const prototype=Object.prototype;
      Reflect.set(prototype,'assertAccess',opaque);`,
    ],
    ['Object.assign', `Object.assign(Object.prototype,{assertAccess:opaque});`],
    ['delete', `delete (Object.prototype as any).assertAccess;`],
    ['unary increment', `++(Object.prototype as any).assertAccess;`],
  ] as const)('rejects an absent callback after %s mutates the prototype', (_kind, mutation) => {
    const program = checkedProgram({ 'route.ts': prototypeRoute(mutation) })
    const row = routeContract(program, 'route.ts', 'PUT:/vote')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('retains an own concrete callback despite a prototype mutation', () => {
    const program = checkedProgram({
      'route.ts': prototypeRoute(
        '(Object.prototype as any).assertAccess=opaque;',
        '{assertAccess:(ctx:any)=>ctx.assert(true)}',
      ),
    })
    const row = routeContract(program, 'route.ts', 'PUT:/vote')
    expect(row?.unavailableReason).toBeUndefined()
    expect(responseStatusCodesForContract(row!)).toEqual([204])
  })
})
