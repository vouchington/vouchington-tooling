import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createHttpContextReceiverProofs } from './protocol-http-context-receiver-proofs.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import { registeredContextApplication } from './protocol-http-context-application.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'

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
  export declare class Application {
    extend(value:object):void;route(path:string):{get(handler:(ctx:Context)=>unknown):void};
  }`,
  )
  const names = Object.keys(bodies)
  const source = `import {Application,type Context} from '@jongleberry/api-server';
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
  const program = ts.createProgram([file], options)
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((value) => ts.flattenDiagnosticMessageText(value.messageText, '\n')),
  ).toEqual([])
  rows = discoverApiResponseContracts(program, [program.getSourceFile(file)!], undefined, {
    onRouteError: () => {},
  })
})
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
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

const ancestryCases = [
  ['global root', 'helper(independent)', false],
  ['chained registration', 'execute({before:()=>helper(selected)})', true],
  ['direct receiver', 'selected.helper()', true],
  ['nested receiver', 'execute({before:()=>selected.helper()})', true],
  ['invoked', '(()=>helper(selected))()', true],
  ['opaque callback', 'execute({before:()=>helper(selected)})', true],
  ['uninvoked', 'const unused=()=>helper(selected)', false],
  ['dead callback', 'if(false)execute({before:()=>helper(selected)})', false],
  ['wrong response', 'execute({before:()=>selected.response.helper()})', false],
  ['independent context', 'execute({before:()=>helper(independent)})', false],
  ['mutable alias', 'let alias=selected;execute({before:()=>helper(alias)})', false],
  ['mixed registration', 'execute({before:()=>helper(selected)})', false],
] as const
it.each(ancestryCases)('retains exact captured context ancestry: %s', (name, body, accepted) => {
  const file = join(root, `ancestry-${name.replaceAll(' ', '-')}.mts`)
  writeFileSync(
    file,
    `declare class Context {helper():void;response:Context};
    interface Builder {get(handler:(ctx:Context)=>unknown):Builder};
    declare class Application {route(path:string):Builder};
    declare function execute(options:{before:()=>void}):void;
    declare function helper(ctx:Context):void;declare const independent:Context;
    const app=new Application();const other=new Application();
    const handler=(selected:Context)=>{${name === 'global root' ? '' : body}};
    ${name === 'global root' ? body : ''}
    app.route('/test')${name === 'chained registration' ? '.get(()=>{})' : ''}.get(handler);
    ${name === 'mixed registration' ? "other.route('/test').get(handler);" : ''}`,
  )
  const program = ts.createProgram([file], {
    strict: true,
    noEmit: true,
    types: [],
    target: ts.ScriptTarget.ESNext,
  })
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((value) => ts.flattenDiagnosticMessageText(value.messageText, '\n')),
  ).toEqual([])
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(file)!
  let call: ts.CallExpression | undefined
  let context: ts.Symbol | undefined
  let application: ts.Symbol | undefined
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 'helper') ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'helper'))
    )
      call = node
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === 'selected')
      context = checker.getSymbolAtLocation(node.name)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'app')
      application = checker.getSymbolAtLocation(node.name)
    if (
      name === 'global root' &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'independent'
    )
      context = checker.getSymbolAtLocation(node.name)
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(call).toBeDefined()
  expect(context).toBeDefined()
  expect(application).toBeDefined()
  const proofs = createHttpContextReceiverProofs(
    checker,
    [source],
    program.getCompilerOptions(),
    createProtocolCallbackValueResolver(checker),
  )
  expect(proofs.extension(call!, context!, call!, context)).toBeUndefined()
  expect(proofs.extension(call!, context!, call!, context)).toBeUndefined()
  expect(registeredContextApplication(call!, checker, [source], context)).toBe(
    accepted ? application : undefined,
  )
})
