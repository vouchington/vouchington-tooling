import { describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createContextConsumerSources } from './protocol-http-context-consumer-sources.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function checkedProgram(files: Record<string, string>, commonJs = false): ts.Program {
  const options: ts.CompilerOptions = {
    module: commonJs ? ts.ModuleKind.NodeNext : ts.ModuleKind.ESNext,
    moduleResolution: commonJs ? ts.ModuleResolutionKind.NodeNext : ts.ModuleResolutionKind.Bundler,
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

function contract(program: ts.Program, route = 'route.ts') {
  const source = program.getSourceFile(`/virtual/${route}`)
  if (!source) throw new Error(`Missing route ${route}`)
  return discoverApiResponseContracts(program, [source], new Set(['PUT:/vote']))['PUT:/vote']
}

function expectUnknown(program: ts.Program, route?: string): void {
  const row = contract(program, route)
  expect(row?.statusKnowledge).toBe('unknown')
  expect(row?.unavailableReason).toBeTruthy()
}

function expectNoContent(program: ts.Program, route?: string): void {
  const row = contract(program, route)
  expect(row?.unavailableReason).toBeUndefined()
  expect(responseStatusCodesForContract(row!)).toEqual([204])
}

const header = `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare function opaque(ctx:any):void;
  type Options={assertAccess?:(ctx:any)=>void};
  function factory(options:Options){return(ctx:any)=>{
    if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}`
const route = (setup: string) => `${header}
  ${setup}
  app.route('/vote').put((ctx:any)=>{
    apiNoContent('PUT:/vote');factory(options)(ctx)});export {};`

describe('HTTP context proof follows default values and opaque capabilities', () => {
  it('keeps an untouched absent optional callback at 204', () => {
    expectNoContent(checkedProgram({ 'route.ts': route('const options:Options={};') }))
  })

  it('rejects an inherited getter installed through __defineGetter__', () => {
    expectUnknown(
      checkedProgram({
        'route.ts': route(`const options:Options={};
          (options as any).__defineGetter__('assertAccess',()=>opaque);`),
      }),
    )
  })

  it('rejects a CommonJS import-equals consumer write to the imported options', () => {
    const program = checkedProgram(
      {
        'options.cts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
        'consumer.cts': `import mod=require('./options.cjs');
          declare const opaque:(ctx:any)=>void;mod.options.assertAccess=opaque;`,
        'route.cts': `import {options} from './options.cjs';
          ${header}
          app.route('/vote').put((ctx:any)=>{
            apiNoContent('PUT:/vote');factory(options)(ctx)});`,
      },
      true,
    )
    expectUnknown(program, 'route.cts')
  })

  it('keeps an imported callback when no consumer writes it', () => {
    const program = checkedProgram(
      {
        'options.cts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
        'route.cts': `import {options} from './options.cjs';
          ${header}
          app.route('/vote').put((ctx:any)=>{
            apiNoContent('PUT:/vote');factory(options)(ctx)});`,
      },
      true,
    )
    expectNoContent(program, 'route.cts')
  })

  it('rejects a callback overwritten through an omitted default argument', () => {
    expectUnknown(
      checkedProgram({
        'route.ts': route(`const options={assertAccess:(ctx:any)=>ctx.assert(true)};
          function mutate(value=options){value.assertAccess=opaque}mutate();`),
      }),
    )
  })

  it('rejects an omitted second default argument after a missing first argument', () => {
    expectUnknown(
      checkedProgram({
        'route.ts': route(`const options={assertAccess:(ctx:any)=>ctx.assert(true)};
          function mutate(first?:any,value=options){value.assertAccess=opaque}mutate();`),
      }),
    )
  })

  it('keeps a callback read through an omitted default argument', () => {
    expectNoContent(
      checkedProgram({
        'route.ts': route(`const options={assertAccess:(ctx:any)=>ctx.assert(true)};
          function inspect(value=options){void value.assertAccess}inspect();`),
      }),
    )
  })

  it('rejects a context passed into an opaque constructor before status 204', () => {
    const source = `${header}
      declare class Sink{constructor(value:any)}
      const options:Options={};
      function handler(ctx:any){new Sink(ctx);ctx.setStatus(204)}
      app.route('/vote').put((ctx:any)=>{
        apiNoContent('PUT:/vote');handler(ctx)});export {};`
    expectUnknown(checkedProgram({ 'route.ts': source }))
  })

  it('keeps status 204 when an opaque constructor receives only a primitive', () => {
    const source = `${header}
      declare class Sink{constructor(value:any)}
      const options:Options={};
      function handler(ctx:any){new Sink(42);ctx.setStatus(204)}
      app.route('/vote').put((ctx:any)=>{
        apiNoContent('PUT:/vote');handler(ctx)});export {};`
    expectNoContent(checkedProgram({ 'route.ts': source }))
  })

  it('indexes actual importing consumers on first query and caches later queries', () => {
    const program = checkedProgram({
      'options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
      'consumer.ts': `import {options} from './options.js';export const selected=options;`,
    })
    const source = program.getSourceFile('/virtual/options.ts')
    const consumer = program.getSourceFile('/virtual/consumer.ts')
    if (!source || !consumer) throw new Error('Missing consumer graph fixture')
    const checker = program.getTypeChecker()
    let symbolLookups = 0
    let forbidAdditionalLookups = false
    const instrumented = new Proxy(checker, {
      get(target, property) {
        if (property === 'getSymbolAtLocation')
          return (node: ts.Node) => {
            if (forbidAdditionalLookups) throw new Error('Consumer graph was scanned twice')
            symbolLookups += 1
            return target.getSymbolAtLocation(node)
          }
        const value: unknown = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const consumers = createContextConsumerSources(instrumented, [source, consumer])
    expect(symbolLookups).toBe(0)
    expect(consumers(source)).toEqual([source, consumer])
    expect(symbolLookups).toBeGreaterThan(0)
    forbidAdditionalLookups = true
    expect(consumers(source)).toEqual([source, consumer])
  })

  it('does not mistake an ambient module declaration for a source-file consumer', () => {
    const program = checkedProgram({
      'ambient.d.ts': `declare module 'external' { export const value:number }`,
      'consumer.ts': `import {value} from 'external';export const selected=value;`,
    })
    const ambient = program.getSourceFile('/virtual/ambient.d.ts')
    const consumer = program.getSourceFile('/virtual/consumer.ts')
    if (!ambient || !consumer) throw new Error('Missing ambient module fixture')
    const importDeclaration = consumer.statements.find(ts.isImportDeclaration)
    if (!importDeclaration) throw new Error('Missing import declaration')
    const module = program.getTypeChecker().getSymbolAtLocation(importDeclaration.moduleSpecifier)
    expect(module?.declarations?.some(ts.isModuleDeclaration)).toBe(true)
    const consumers = createContextConsumerSources(program.getTypeChecker(), [ambient, consumer])
    expect(consumers(ambient)).toEqual([ambient])
  })
})
