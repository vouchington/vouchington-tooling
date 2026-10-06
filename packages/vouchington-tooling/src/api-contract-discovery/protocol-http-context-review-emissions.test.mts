import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function contract(setup: string, callback = '(ctx:any)=>ctx.assert(true)') {
  const content = `declare const app:any;
    declare function apiNoContent(key:string):void;
    declare function opaque(value:any):void;
    declare const externalCallback:(ctx:any)=>void;
    declare function opaqueTag(strings:TemplateStringsArray,...values:any[]):string;
    type Options={assertAccess?:(ctx:any)=>void};
    function factory(options:Options){return(ctx:any)=>{
      if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}
    const options={assertAccess:${callback}};
    ${setup}
    app.route('/vote').put((ctx:any)=>{
      apiNoContent('PUT:/vote');factory(options)(ctx)});export {};`
  return discover(content, 'PUT:/vote')
}

function redirectContract(body: string) {
  const content = `declare const app:any;
    declare function apiOpenApiNoContent(key:string,status:number):void;
    function redirect(ctx:Context){
      ctx.setStatus(302);ctx.set('Location','/ui');
      ${body}
      ctx.response.empty()}
    function redirectToUi(ctx:Context){redirect(ctx)}
    app.route('/login').get((ctx:Context)=>{
      apiOpenApiNoContent('GET:/login',302);redirectToUi(ctx)});export {};`
  return discover(content, 'GET:/login')
}

function discover(content: string, key: string) {
  let fixtureRoot: string | undefined
  if (key === 'GET:/login') {
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
      'export declare class Context {set(header:string,value:string):void;setStatus(status:number):void;json(value:unknown):void;response:{empty():void}}',
    )
    content = `import type {Context} from '@jongleberry/api-server';${content}`
  }
  const name = fixtureRoot ? join(fixtureRoot, 'route.ts') : '/virtual/route.ts'
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  }
  const host = ts.createCompilerHost(options, true)
  const originalSource = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, createNew) =>
    file === name
      ? ts.createSourceFile(file, content, languageVersion, true, ts.ScriptKind.TS)
      : originalSource(file, languageVersion, onError, createNew)
  const originalExists = host.fileExists.bind(host)
  host.fileExists = (file) => file === name || originalExists(file)
  const originalDirectory = host.directoryExists?.bind(host)
  host.directoryExists = (file) =>
    file === (fixtureRoot ?? '/virtual') || !!originalDirectory?.(file)
  const originalRead = host.readFile.bind(host)
  host.readFile = (file) => (file === name ? content : originalRead(file))
  const program = ts.createProgram([name], options, host)
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([])
  const source = program.getSourceFile(name)
  if (!source) throw new Error('Missing route fixture')
  try {
    return discoverApiResponseContracts(program, [source], new Set([key]))[key]
  } finally {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

describe('HTTP context proof includes writes and opaque emissions', () => {
  it('retains a stable callback without an opaque emission', () => {
    const row = contract('')
    expect(row?.unavailableReason).toBeUndefined()
    expect(responseStatusCodesForContract(row!)).toEqual([204])
  })

  it.each([
    ['for-of assignment', `for(options.assertAccess of [externalCallback]){}`],
    ['for-in assignment', `for((options as any).assertAccess in {entry:1}){}`],
  ] as const)('rejects a callback overwritten by %s', (_kind, setup) => {
    const row = contract(setup)
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('rejects an options object exposed through a class field', () => {
    const row = contract(`const selected=options;
      class Box{value=selected}opaque(new Box());`)
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('rejects a callback that emits JSON before the factory sets no-content status', () => {
    const row = contract('', '(ctx:any)=>ctx.json({unexpected:true})')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('rejects a callback that invokes the context pipeline without a known body', () => {
    const row = contract('', '(ctx:any)=>ctx.pipeline()')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('rejects a callback that replaces the context JSON implementation', () => {
    const row = contract('', '(ctx:any)=>{ctx.json=externalCallback}')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('rejects options passed as a tagged-template substitution to an opaque tag', () => {
    const row = contract('opaqueTag`' + '${options}' + '`;')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it('retains a stable callback when a tag receives only a primitive property', () => {
    const row = contract('const scalar={value:7};opaqueTag`' + '${scalar.value}' + '`;')
    expect(row?.unavailableReason).toBeUndefined()
    expect(responseStatusCodesForContract(row!)).toEqual([204])
  })

  it('leaves the response-only contract empty for a documented 302 redirect helper', () => {
    const row = redirectContract('')
    expect(row).toBeUndefined()
  })

  it('rejects a JSON body emitted by the same redirect helper chain', () => {
    const row = redirectContract('ctx.json({unexpected:true});')
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })
})
