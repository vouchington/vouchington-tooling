import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function checkedProgram(files: Record<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    types: ['node'],
    typeRoots: [resolve('node_modules/@types')],
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

const controls = {
  argumentsWrite:
    "import('./options.js').then(function(module){arguments[0].options.assertAccess=opaque})",
  argumentsLexicalArrow:
    "import('./options.js').then(function(module){const mutate=()=>{arguments[0].options.assertAccess=opaque};mutate()})",
  argumentsAssign:
    "import('./options.js').then(function(module){Object.assign(arguments[0].options,{assertAccess:opaque})})",
  argumentsRead:
    "import('./options.js').then(function(module){void arguments[0].options.assertAccess})",
  argumentsDead:
    "import('./options.js').then(function(module){if(false)void arguments[0].options.assertAccess})",
  argumentsIndependent:
    "import('./options.js').then(function(module){function other(value:any){arguments[0].options.assertAccess=opaque};other({options:{}})})",
  requireWrite: "const {options}=require('./options.cjs');options.assertAccess=opaque",
  requireAlias: "const {options:selected}=require('./options.cjs');selected.assertAccess=opaque",
  requireRead: "const {options}=require('./options.cjs');void options.assertAccess",
  requireDead: "const {options}=require('./options.cjs');if(false)void options.assertAccess",
  requireIndependent: "const {other}=require('./options.cjs');other.assertAccess=opaque",
} as const
function files(name: keyof typeof controls) {
  const required = name.startsWith('require')
  const suffix = required ? 'cts' : 'ts'
  const extension = required ? 'cjs' : 'js'
  return {
    [`options.${suffix}`]:
      'export const options={assertAccess:(ctx:any)=>ctx.assert(true)};export const other={assertAccess:(ctx:any)=>ctx.assert(true)};',
    'consumer.ts': `declare const opaque:(ctx:any)=>void;${controls[name]};export {};`,
    'route.ts': `import {options as importedOptions} from './options.${extension}';${route('', 'importedOptions')}`,
  }
}
it.each([
  'argumentsWrite',
  'argumentsAssign',
  'argumentsLexicalArrow',
  'requireWrite',
  'requireAlias',
] as const)('rejects selected exported callback mutation via %s', (name) =>
  expectUnknown(files(name)),
)
it.each([
  'argumentsRead',
  'argumentsDead',
  'argumentsIndependent',
  'requireRead',
  'requireDead',
  'requireIndependent',
] as const)('retains independent or unused module origins via %s', (name) =>
  expectNoContent(files(name)),
)
