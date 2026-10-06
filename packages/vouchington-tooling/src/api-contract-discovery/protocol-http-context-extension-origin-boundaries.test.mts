import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import { createHttpContextReceiverProofs } from './protocol-http-context-receiver-proofs.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { registeredContextApplication } from './protocol-http-context-application.mts'
import { createHttpContextPlatformMethodProof } from './protocol-http-context-platform-methods.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'

const bodies = {
  headers: "this.set('X-Test','safe');this.setType('text/plain')",
  termination: "this.throw(403,'denied')",
  readonly: 'return this.label',
  ignored: '',
  nested: "function helper(ctx:Context){ctx.set('X-Test','safe')}helper(this)",
  escaped: 'opaque(this)',
  returned: 'return this',
  rawjson: 'this.json({raw:true})',
  buffered: "this.response.buffer('raw')",
} as const
let root: string
let program: ts.Program
const extraRoots: string[] = []
let rows: ReturnType<typeof discoverApiResponseContracts>
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'protocol-context-extension-bodies-'))
  const dependency = join(root, 'node_modules/@jongleberry/api-server')
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
    `export declare class Context {
    label:string;response:{empty(value?:void):void;buffer(value:unknown):void};
    set(header:string,value:string):void;setType(value:string):void;throw(status:number,message?:string):never;
    setStatus(status:number):void;json(value:unknown):void;
  }
  export interface RouteBuilder {get(handler:(ctx:Context)=>unknown):RouteBuilder;post(handler:(ctx:Context)=>unknown):RouteBuilder}
  export declare class Application {
    extend(value:object):void;route(path:string):RouteBuilder;
  }`,
  )
  writeFileSync(join(root, 'unrelated.mts'), `export const unrelated='independent';`)
  const names = Object.keys(bodies)
  const source = `import {Application,type Context} from '@jongleberry/api-server';
    import {unrelated} from './unrelated.mjs';void unrelated;
    declare function opaque(value:unknown):void;
    declare function apiNoContent<K extends string>(key:K):void;
    declare module '@jongleberry/api-server' {interface Context {
      ${names.map((name) => `${name}():unknown;`).join('')}unregistered():void;
    }}
    const app=new Application();const other=new Application();
    const extensions={${Object.entries(bodies)
      .map(([name, body]) => `${name}(this:Context){${body}}`)
      .join(',')}};
    app.extend(extensions);
    ${names
      .map(
        (name) => `app.route('/${name}').get((ctx:Context)=>{
      ctx.${name}();ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/${name}'));
    });`,
      )
      .join('')}
    declare const globalCtx:Context;globalCtx.headers();
    function unbound(ctx:Context){ctx.headers()}
    app.route('/chain').get(()=>{}).post((ctx:Context)=>{ctx.headers();ctx.setStatus(204);ctx.response.empty(apiNoContent('POST:/chain'))});
    app.route('/unregistered').get((ctx:Context)=>{ctx.unregistered();ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/unregistered'))});
    app.route('/wrongreceiver').get((ctx:Context)=>{(ctx.response as unknown as Context).set('x','y');ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/wrongreceiver'))});
    app.route('/userset').get((ctx:Context)=>{(ctx as Context&{set(header:string,value:string):void}).set('x','y');ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/userset'))});`
  const file = join(root, 'routes.mts')
  writeFileSync(file, source)
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  }
  program = ts.createProgram([file], options)
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((value) => ts.flattenDiagnosticMessageText(value.messageText, '\n')),
  ).toEqual([])
  rows = discoverApiResponseContracts(program, [program.getSourceFile(file)!], undefined, {
    onRouteError: () => {},
  })
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  extraRoots.forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})
it.each(['headers', 'termination', 'readonly', 'ignored', 'nested'] as const)(
  'proves the actual associated body %s',
  (name) => expect(rows[`GET:/${name}`]?.unavailableReason).toBeUndefined(),
)
it.each([
  'escaped',
  'returned',
  'rawjson',
  'buffered',
  'unregistered',
  'wrongreceiver',
  'userset',
] as const)('retains the selected capability boundary in %s', (name) =>
  expect(rows[`GET:/${name}`]?.unavailableReason).toBeDefined(),
)

it('retains an associated producer through the actual chained route builder', () => {
  expect(rows['POST:/chain']?.statusKnowledge).toBe('explicit')
  expect(rows['POST:/chain']?.unavailableReason).toBeUndefined()
})

function callAndContext(
  source: ts.SourceFile,
  text: string,
  checker: ts.TypeChecker,
  ownerName?: string,
) {
  let call: ts.CallExpression | undefined
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText() === text &&
      (!ownerName || enclosingFunction(node)?.name?.getText() === ownerName)
    )
      call = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(call).toBeDefined()
  if (!call || !ts.isPropertyAccessExpression(call.expression))
    throw new Error('Missing actual method call')
  const context = checker.getSymbolAtLocation(call.expression.expression)
  expect(context).toBeDefined()
  return { call, context: context! }
}
it.each(['globalCtx.headers', 'ctx.headers'])(
  'declines a context without selected registration in %s',
  (text) => {
    const checker = program.getTypeChecker()
    const source = program.getSourceFile(join(root, 'routes.mts'))!
    const { call, context } = callAndContext(
      source,
      text,
      checker,
      text === 'ctx.headers' ? 'unbound' : undefined,
    )
    if (text === 'globalCtx.headers')
      expect(registeredContextApplication(call, checker, program.getSourceFiles())).toBeUndefined()
    const proofs = createHttpContextReceiverProofs(
      checker,
      program.getSourceFiles(),
      program.getCompilerOptions(),
      createProtocolCallbackValueResolver(checker),
    )
    expect(proofs.extension(call, context, call)).toBeUndefined()
  },
)

it.each(['@jongleberry/api-server', 'counterfeit-api-server'])(
  'uses actual aliased class exports only from verified package metadata %s',
  (packageName) => {
    const directory = mkdtempSync(join(tmpdir(), 'protocol-context-alias-export-'))
    extraRoots.push(directory)
    const dependency = join(directory, 'node_modules/@jongleberry/api-server')
    mkdirSync(dependency, { recursive: true })
    writeFileSync(
      join(dependency, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '0.0.0',
        type: 'module',
        types: './index.d.mts',
      }),
    )
    writeFileSync(
      join(dependency, 'index.d.mts'),
      `declare class ConcreteContext{set(header:string,value:string):void};declare class ConcreteApplication{extend(value:object):void;route(path:string):void};export{ConcreteContext as Context,ConcreteApplication as Application};`,
    )
    const file = join(directory, 'route.mts')
    writeFileSync(
      file,
      `import {Application,type Context} from '@jongleberry/api-server';const app=new Application();declare const ctx:Context;ctx.set('X-Test','safe');export{app};`,
    )
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    }
    const aliasProgram = ts.createProgram([file], options)
    expect(ts.getPreEmitDiagnostics(aliasProgram)).toEqual([])
    const checker = aliasProgram.getTypeChecker()
    const { call, context } = callAndContext(aliasProgram.getSourceFile(file)!, 'ctx.set', checker)
    const proof = createHttpContextPlatformMethodProof(
      checker,
      aliasProgram.getSourceFiles(),
      options,
    )
    expect(proof.platformMethod(call, context)).toBe(packageName === '@jongleberry/api-server')
    expect(proof.applicationClass?.getName()).toBe(
      packageName === '@jongleberry/api-server' ? 'ConcreteApplication' : undefined,
    )
  },
)
