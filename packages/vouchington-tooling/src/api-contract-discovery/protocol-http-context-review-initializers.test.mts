import { describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { contextCallbackExecutionRoots } from './protocol-http-context-parameter-initializers.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function contract(content: string) {
  const name = '/virtual/route.ts'
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  }
  const host = ts.createCompilerHost(options, true)
  const getSourceFile = host.getSourceFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const directoryExists = host.directoryExists?.bind(host)
  const readFile = host.readFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, createNew) =>
    file === name
      ? ts.createSourceFile(file, content, languageVersion, true)
      : getSourceFile(file, languageVersion, onError, createNew)
  host.fileExists = (file) => file === name || fileExists(file)
  host.directoryExists = (file) => file === '/virtual' || !!directoryExists?.(file)
  host.readFile = (file) => (file === name ? content : readFile(file))
  const program = ts.createProgram([name], options, host)
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([])
  const source = program.getSourceFile(name)
  if (!source) throw new Error('Missing route source')
  return discoverApiResponseContracts(program, [source], new Set(['PUT:/vote']))['PUT:/vote']
}

function expectUnknown(content: string): void {
  const row = contract(content)
  expect(row?.statusKnowledge).toBe('unknown')
  expect(row?.unavailableReason).toBeTruthy()
}

function expectNoContent(content: string): void {
  const row = contract(content)
  expect(row?.unavailableReason).toBeUndefined()
  expect(responseStatusCodesForContract(row!)).toEqual([204])
}

const route = (
  setup: string,
  callbackCall = 'options.assertAccess(ctx)',
  factoryParameters = 'options:Options',
  invocation = 'factory(options)(ctx)',
) => `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare function opaqueTag(strings:TemplateStringsArray,...values:any[]):void;
  type Context={params:{id:string};assert(value:boolean):void;setStatus(status:number):void;json(value:any):void};
  type Options={assertAccess?:(ctx:Context,value?:unknown)=>void};
  function factory(${factoryParameters}){return(ctx:Context)=>{
    if(options.assertAccess)${callbackCall};ctx.setStatus(204)}}
  ${setup}
  app.route('/vote').put((ctx:Context)=>{
    apiNoContent('PUT:/vote');${invocation}});export {};`

describe('HTTP context proof follows callback initialization and template evaluation', () => {
  it('rejects a response body emitted by an omitted callback default argument', () => {
    expectUnknown(
      route(`const options={assertAccess:(ctx:Context,value:unknown=ctx.json({bad:true}))=>{}};`),
    )
  })

  it('keeps 204 when the same callback default is bypassed by a provided argument', () => {
    expectNoContent(
      route(
        `const options={assertAccess:(ctx:Context,value:unknown=ctx.json({bad:true}))=>{}};`,
        'options.assertAccess(ctx, true)',
      ),
    )
  })

  it('rejects a response body when undefined explicitly selects the callback default', () => {
    expectUnknown(
      route(
        `const options={assertAccess:(ctx:Context,value:unknown=ctx.json({bad:true}))=>{}};`,
        'options.assertAccess(ctx, undefined)',
      ),
    )
  })

  it('rejects a callback default when a union argument may be undefined', () => {
    expectUnknown(
      route(
        `declare const choose:boolean;
         const options={assertAccess:(ctx:Context,value:unknown=ctx.json({bad:true}))=>{}};`,
        'options.assertAccess(ctx, choose ? undefined : true)',
      ),
    )
  })

  it('keeps 204 when null bypasses the callback default', () => {
    expectNoContent(
      route(
        `const options={assertAccess:(ctx:Context,value:unknown=ctx.json({bad:true}))=>{}};`,
        'options.assertAccess(ctx, null)',
      ),
    )
  })

  it('keeps 204 when a supplied satisfies expression bypasses the default', () => {
    expectNoContent(
      route(
        `const options={assertAccess:(ctx:Context,value:unknown=ctx.json({bad:true}))=>{}};`,
        'options.assertAccess(ctx, true satisfies boolean)',
      ),
    )
  })

  it('keeps 204 when the canonical context is supplied as the second argument', () => {
    expectNoContent(
      route(
        `const options={assertAccess:(ctx:Context,value:unknown=ctx.json({bad:true}))=>{}};`,
        'options.assertAccess(ctx, ctx)',
      ),
    )
  })

  it('keeps 204 when a supplied value is forwarded through the factory parameter', () => {
    expectNoContent(
      route(
        `const options={assertAccess:(ctx:Context,value:unknown=ctx.json({bad:true}))=>{}};`,
        'options.assertAccess(ctx, supplied)',
        'options:Options,supplied:unknown',
        'factory(options, true)(ctx)',
      ),
    )
  })

  it('keeps 204 when a const supplied value is forwarded through the factory', () => {
    expectNoContent(
      route(
        `const options={assertAccess:(ctx:Context,value:unknown=ctx.json({bad:true}))=>{}};
         const supplied=true;`,
        'options.assertAccess(ctx, value)',
        'options:Options,value:unknown',
        'factory(options, supplied)(ctx)',
      ),
    )
  })

  it('conservatively retains a default when unchecked const arguments cycle', () => {
    const name = '/virtual/cycle.js'
    const content = `function callback(ctx,value=ctx.json({bad:true})){return value}
      const first=second;const second=first;callback(null,first)`
    const options: ts.CompilerOptions = {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
    }
    const host = ts.createCompilerHost(options, true)
    const getSourceFile = host.getSourceFile.bind(host)
    const fileExists = host.fileExists.bind(host)
    const readFile = host.readFile.bind(host)
    host.getSourceFile = (file, languageVersion, onError, createNew) =>
      file === name
        ? ts.createSourceFile(file, content, languageVersion, true, ts.ScriptKind.JS)
        : getSourceFile(file, languageVersion, onError, createNew)
    host.fileExists = (file) => file === name || fileExists(file)
    host.readFile = (file) => (file === name ? content : readFile(file))
    const program = ts.createProgram([name], options, host)
    expect(ts.getPreEmitDiagnostics(program)).toEqual([])
    const source = program.getSourceFile(name)
    const fn = source?.statements.find(ts.isFunctionDeclaration)
    const call = source?.statements
      .filter(ts.isExpressionStatement)
      .map((statement) => statement.expression)
      .find(ts.isCallExpression)
    if (!fn?.body || !call || !fn.parameters[0] || !fn.parameters[1])
      throw new Error('Missing unchecked default-cycle fixture')
    const checker = program.getTypeChecker()
    const context = checker.getSymbolAtLocation(fn.parameters[0].name)
    if (!context) throw new Error('Missing real callback context symbol')
    const roots = contextCallbackExecutionRoots(fn, call, new Map(), checker, [context])
    expect(roots).toContain(fn.parameters[1])
    expect(roots).toContain(fn.body)
  })

  it('rejects an opaque tag receiving the context as a template substitution', () => {
    expectUnknown(route('const options={assertAccess:(ctx:Context)=>opaqueTag`' + '${ctx}' + '`};'))
  })

  it('keeps 204 when an opaque tag receives only a primitive context member', () => {
    expectNoContent(
      route('const options={assertAccess:(ctx:Context)=>opaqueTag`' + '${ctx.params.id}' + '`};'),
    )
  })

  it('accepts a concrete callback through a structurally typed options object', () => {
    expectNoContent(
      route(`const options={assertAccess:(ctx:Context)=>ctx.assert(true)} satisfies Options;`),
    )
  })

  it('rejects an opaque callback through the same options structure', () => {
    expectUnknown(
      route(`declare const opaque:(ctx:Context)=>void;
        const options={assertAccess:opaque} satisfies Options;`),
    )
  })
})
