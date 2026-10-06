import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'

const bodies = {
  headers: "this.cacheControl('public',60)",
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
    cacheControl(type:string,ttl?:number):void;setStatus(status:number):void;json(value:unknown):void;
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
    app.route('/wrongreceiver').get((ctx:Context)=>{(ctx.response as unknown as Context).cacheControl('public',60);ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/wrongreceiver'))});
    app.route('/userset').get((ctx:Context)=>{(ctx as Context&{cacheControl(type:string,ttl?:number):void}).cacheControl('public',60);ctx.setStatus(204);ctx.response.empty(apiNoContent('GET:/userset'))});`
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
