import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { contextModuleOrigin } from './protocol-http-context-module-origin.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function checkedProgram(files: Record<string, string>, directory = '/virtual'): ts.Program {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  }
  const contents = new Map(
    Object.entries(files).map(([name, text]) => [join(directory, name), text]),
  )
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
  host.directoryExists = (name) => name === directory || !!directoryExists?.(name)
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

const route = (declarations: string, body = 'factory(options)(ctx)') => `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare function opaque(...values:any[]):void;
  ${declarations}
  app.route('/vote').put((ctx:any)=>{
    apiNoContent('PUT:/vote');${body}});export {};`

const optionalFactory = `type Options={assertAccess?:(ctx:any)=>void};
  function factory(options:Options){return(ctx:any)=>{
    if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}`

describe('HTTP context proof includes late effects and module consumers', () => {
  it('keeps a documented 302 redirect through nested direct helpers response-only', () => {
    let fixtureRoot: string
    fixtureRoot = mkdtempSync(join(tmpdir(), 'protocol-platform-provenance-'))
    const dependency = join(fixtureRoot, 'node_modules/@jongleberry/api-server')
    mkdirSync(dependency, { recursive: true })
    writeFileSync(
      join(dependency, 'package.json'),
      JSON.stringify({
        name: '@jongleberry/api-server',
        version: '0.0.0',
        type: 'module',
        types: './index.d.mts',
      }),
    )
    writeFileSync(
      join(dependency, 'index.d.mts'),
      'export declare class Context {set(header:string,value:string):void;setStatus(status:number):void;response:{empty():void}}',
    )
    try {
      const program = checkedProgram(
        {
          'route.ts': `import type {Context} from '@jongleberry/api-server';declare const app:any;
        declare function apiOpenApiNoContent(key:string,status:number):void;
        function redirect(ctx:Context){
          ctx.setStatus(302);ctx.set('Location','/ui');ctx.response.empty()}
        function complete(ctx:Context){redirect(ctx)}
        app.route('/login').get((ctx:Context)=>{
          apiOpenApiNoContent('GET:/login',302);complete(ctx)});export {};`,
        },
        fixtureRoot,
      )
      const source = program.getSourceFile(join(fixtureRoot, 'route.ts'))
      if (!source) throw new Error('Missing redirect route')
      const row = discoverApiResponseContracts(program, [source], new Set(['GET:/login']))[
        'GET:/login'
      ]
      expect(row).toBeUndefined()
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('rejects JSON emitted while evaluating a handler condition', () => {
    const declarations = `function audit(ctx:any){ctx.json({leaked:true});return null}
      function factory(){return(ctx:any)=>{if(audit(ctx))opaque(ctx);ctx.setStatus(204)}}`
    expectUnknown({ 'route.ts': route(declarations, 'factory()(ctx)') })
  })

  it('keeps 204 for a null condition with no context side effect', () => {
    const declarations = `function audit(){return null}
      function factory(){return(ctx:any)=>{if(audit())opaque(ctx);ctx.setStatus(204)}}`
    expectNoContent({ 'route.ts': route(declarations, 'factory()(ctx)') })
  })

  it('keeps an untouched missing optional callback at 204', () => {
    expectNoContent({ 'route.ts': route(`${optionalFactory}const options:Options={};`) })
  })

  it('keeps 204 when a concrete callback reads a wrapped context parameter', () => {
    const declarations = `function inspect(box:{path:any}){void box.path}
      const options={assertAccess:(ctx:any)=>inspect({path:ctx.params})};
      ${optionalFactory}`
    expectNoContent({ 'route.ts': route(declarations) })
  })

  it.each([
    ['Object.getPrototypeOf', `Object.getPrototypeOf({}).assertAccess=opaque;`],
    ['__proto__', `({} as any).__proto__.assertAccess=opaque;`],
    ['constructor.prototype', `({} as any).constructor.prototype.assertAccess=opaque;`],
  ] as const)('rejects a callback inherited after %s mutation', (_kind, mutation) => {
    expectUnknown({ 'route.ts': route(`${optionalFactory}${mutation}const options:Options={};`) })
  })

  it('rejects an options object spread into an opaque call', () => {
    const declarations = `${optionalFactory}
      const options={assertAccess:(ctx:any)=>ctx.assert(true)};
      opaque(...[options]);`
    expectUnknown({ 'route.ts': route(declarations) })
  })

  it('rejects a callback that changes status after the factory sets 204', () => {
    const declarations = `type Options={assertAccess:(ctx:any)=>void};
      function factory(options:Options){return(ctx:any)=>{
        ctx.setStatus(204);options.assertAccess(ctx)}}
      const options={assertAccess:(ctx:any)=>ctx.setStatus(201)};`
    expectUnknown({ 'route.ts': route(declarations) })
  })

  it('keeps the status set by a returned const handler', () => {
    const declarations = `function factory(){
      const handler=(ctx:any)=>{ctx.setStatus(204)};return handler}`
    expectNoContent({ 'route.ts': route(declarations, 'factory()(ctx)') })
  })

  it('rejects a factory that can return before creating the handler', () => {
    const declarations = `function factory(){
      if(Math.random()>0.5)return;
      const handler=(_ignored:number,ctx:any)=>{ctx.setStatus(204)};return handler}`
    expectUnknown({ 'route.ts': route(declarations, 'factory()!(0,ctx)') })
  })

  it('rejects a second-argument status helper before a bare route return', () => {
    expectUnknown({
      'route.ts': route(
        '',
        `function callback(_flag:any,value:any){value.setStatus(201)};
         callback(false,ctx);return;`,
      ),
    })
  })

  it('rejects a callback declared without an implementation in a type declaration', () => {
    expectUnknown({
      'callbacks.d.ts': `export declare function callback(ctx:any):void;`,
      'route.ts': `import {callback} from './callbacks.js';
        ${route(`${optionalFactory}const options={assertAccess:callback};`)}`,
    })
  })

  it('rejects a context spread through an array into an opaque callback', () => {
    const declarations = `${optionalFactory}
      const options={assertAccess:(ctx:any)=>opaque(...[ctx])};`
    expectUnknown({ 'route.ts': route(declarations) })
  })

  it.each([
    ['object', `function emit(box:{ctx:any}){box.ctx.json({leaked:true})}`, 'emit({ctx})'],
    ['array', `function emit(box:any[]){box[0].json({leaked:true})}`, 'emit([ctx])'],
  ] as const)('rejects JSON through a concrete %s wrapper', (_kind, helper, invoke) => {
    const declarations = `${helper}
      const options={assertAccess:(ctx:any)=>${invoke}};
      ${optionalFactory}`
    expectUnknown({ 'route.ts': route(declarations) })
  })

  it.each([
    ['escape', `import('./options.js').then(module=>opaque(module.options));`],
    ['write', `import('./options.js').then(module=>{module.options.assertAccess=opaque});`],
  ] as const)('rejects an exported callback reached by a promise %s consumer', (_kind, use) => {
    expectUnknown({
      'options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
      'consumer.ts': `declare function opaque(value:any):void;${use}export {};`,
      'route.ts': `import {options} from './options.js';
        ${route(
          `type Options={assertAccess:(ctx:any)=>void};
          function factory(value:Options){return(ctx:any)=>{
            value.assertAccess(ctx);ctx.setStatus(204)}}`,
          'factory(options)(ctx)',
        )}`,
    })
  })

  it('rejects a context stored by a callback and emitted later in the route', () => {
    const declarations = `let leaked:any;
      const options={assertAccess:(ctx:any)=>{leaked=ctx}};
      ${optionalFactory}`
    expectUnknown({
      'route.ts': route(declarations, 'factory(options)(ctx);leaked.json({leaked:true})'),
    })
  })

  it('does not treat a Promise.resolve fulfillment parameter as an imported module', () => {
    const program = checkedProgram({
      'route.ts': `Promise.resolve({options:1}).then(module=>module.options);export {};`,
    })
    const source = program.getSourceFile('/virtual/route.ts')
    if (!source) throw new Error('Missing fulfillment source')
    let parameter: ts.ParameterDeclaration | undefined
    function visit(node: ts.Node): void {
      if (ts.isArrowFunction(node)) parameter = node.parameters[0]
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (!parameter) throw new Error('Missing fulfillment parameter')
    const checker = program.getTypeChecker()
    const binding = checker.getSymbolAtLocation(parameter.name)
    expect(binding).toBeDefined()
    expect(contextModuleOrigin(checker, binding)).toBeUndefined()
  })

  it('keeps an absent callback after a numeric property write to a local object', () => {
    const declarations = `${optionalFactory}
      const bucket:any={0:{}};bucket[0].assertAccess=opaque;
      const options:Options={};`
    expectNoContent({ 'route.ts': route(declarations) })
  })
})
