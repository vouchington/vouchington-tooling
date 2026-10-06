import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { contextModuleOrigin } from './protocol-http-context-module-origin.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function checkedProgram(files: Record<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    allowJs: true,
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

const moduleType = "typeof import('./options.js')"
const controls = {
  promiseWrite: `function mutate(module:${moduleType}){module.options.assertAccess=opaque}
    const pending=import('./options.js');pending.then(mutate)`,
  chainedPromiseWrite: `function mutate(module:${moduleType}){module.options.assertAccess=opaque}
    const pending=import('./options.js');const alias=pending;alias.then(mutate)`,
  destructuredPromiseWrite: `function mutate({options}:${moduleType}){options.assertAccess=opaque}
    const pending=import('./options.js');pending.then(mutate)`,
  inlinePromiseWrite: `const pending=import('./options.js');
    pending.then(module=>{module.options.assertAccess=opaque})`,
  promiseRead: `function read(module:${moduleType}){void module.options.assertAccess}
    const pending=import('./options.js');pending.then(read)`,
  independentExport: `function mutate(module:${moduleType}){module.other.assertAccess=opaque}
    const pending=import('./options.js');pending.then(mutate)`,
  ordinaryPromise: `function mutate(module:${moduleType}){module.options.assertAccess=opaque}
    const pending=Promise.resolve({options:{assertAccess:opaque},other:{assertAccess:opaque}});
    pending.then(mutate)`,
  falseWrite: `import {options} from './options.js';if(false)options.assertAccess=opaque`,
  deadElseWrite: `import {options} from './options.js';if(true){}else options.assertAccess=opaque`,
  falseLoopWrite: `import {options} from './options.js';while(false){options.assertAccess=opaque}`,
  actualWrite: `import {options} from './options.js';options.assertAccess=opaque`,
  trueWrite: `import {options} from './options.js';if(true)options.assertAccess=opaque`,
  unknownBranchWrite: `import {options} from './options.js';declare const enabled:boolean;
    if(enabled)options.assertAccess=opaque`,
} as const

function files(name: keyof typeof controls) {
  return {
    'options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};
      export const other={assertAccess:(ctx:any)=>ctx.assert(true)};`,
    'consumer.ts': `declare const opaque:(ctx:any)=>void;${controls[name]};export {};`,
    'route.ts': `import {options} from './options.js';${route('')}`,
  }
}
it.each([
  'promiseWrite',
  'chainedPromiseWrite',
  'destructuredPromiseWrite',
  'inlinePromiseWrite',
  'actualWrite',
  'trueWrite',
  'unknownBranchWrite',
] as const)('rejects executable selected-options mutation: %s', (name) =>
  expectUnknown(files(name)),
)
it.each([
  'promiseRead',
  'independentExport',
  'ordinaryPromise',
  'falseWrite',
  'deadElseWrite',
  'falseLoopWrite',
] as const)('retains independent or statically unreachable writes: %s', (name) =>
  expectNoContent(files(name)),
)

it('does not invent a module origin for an opaque JavaScript promise receiver', () => {
  const program = checkedProgram({
    'consumer.js': 'external.then(function(module){module.options.assertAccess=globalOpaque})',
  })
  const source = program.getSourceFile('/virtual/consumer.js')!
  const checker = program.getTypeChecker()
  let parameter: ts.ParameterDeclaration | undefined
  function visit(node: ts.Node) {
    if (ts.isParameter(node)) parameter = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(parameter).toBeDefined()
  const binding = checker.getSymbolAtLocation(parameter!.name)
  expect(binding).toBeDefined()
  expect(contextModuleOrigin(checker, binding)).toBeUndefined()
})
