import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function checkedProgram(files: Record<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
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

const unsafe = {
  nullish: 'let saved:Context|undefined;opaque(saved??=ctx)',
  or: 'let saved:Context|undefined;opaque(saved||=ctx)',
  and: 'let saved:Context|{independent:true}={independent:true};opaque(saved&&=ctx)',
  missingObject: 'const {saved=ctx}:{saved?:Context}={};opaque(saved)',
  undefinedObject: 'const {saved=ctx}:{saved?:Context}={saved:undefined};opaque(saved)',
  missingArray: 'const [saved=ctx]:[Context?]=[];opaque(saved)',
  undefinedArray: 'const [saved=ctx]:[Context?]=[undefined];opaque(saved)',
  unknownDefault: 'declareValue();const {saved=ctx}={saved:maybe};opaque(saved)',
} as const
const safe = {
  independent: 'let saved:{independent:boolean}|undefined;opaque(saved??={independent:true})',
  providedObject: 'const {saved=ctx}:{saved?:Context}={saved:other};opaque(saved)',
  providedArray: 'const [saved=ctx]:[Context?]=[other];opaque(saved)',
  literalProvided: 'const {saved=ctx}:{saved?:unknown}={saved:{independent:true}};opaque(saved)',
  deadAssignment: 'let saved:Context|undefined;if(false)opaque(saved??=ctx)',
  deadDefault: 'if(false){const {saved=ctx}:{saved?:Context}={};opaque(saved)}',
  ignored:
    'const {saved=ctx}:{saved?:Context}={};function ignore(_value:unknown){};ignore(()=>saved)',
  unused: 'const {saved=ctx}:{saved?:Context}={};ctx.assert(true)',
  providedNull: 'const {saved=ctx}:{saved?:unknown}={saved:null};opaque(saved)',
} as const
const fixture = (body: string) => ({
  'route.ts': route(`const other:Context={params:{id:'other'},assert(){},json(){},setStatus(){}};
  declare const maybe:Context|undefined;declare function declareValue():void;
  const options={assertAccess:(ctx:Context)=>{${body}}};`),
})
it.each(Object.entries(unsafe))('rejects selected assignment or default %s', (_name, body) => {
  expectUnknown(fixture(body))
})
it.each(Object.entries(safe))(
  'retains independent or dead assignment/default %s',
  (_name, body) => {
    expectNoContent(fixture(body))
  },
)
