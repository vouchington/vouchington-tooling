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

const controls = {
  tagClosure: 'opaqueTag`value${()=>ctx.json({bad:true})}`',
  tagReturn: 'opaqueTag`value${()=>ctx}`',
  tagIgnored:
    'function ignoreTag(_strings:TemplateStringsArray,_callback:()=>void){};ignoreTag`value${()=>ctx.json({bad:true})}`',
  tagIndependent: 'const other={json(_value:unknown){}};opaqueTag`value${()=>other.json({})}`',
  tagDead: 'opaqueTag`value${()=>{if(false)ctx.json({bad:true});ctx.assert(true)}}`',
  classCapture: 'class Wrapper{context=ctx};opaque(new Wrapper())',
  classExpression: 'const Wrapper=class{context=ctx};opaque(new Wrapper())',
  classIndependent: 'class Wrapper{context={independent:true}};opaque(new Wrapper())',
  classUnused: 'class Wrapper{context=ctx};ctx.assert(true)',
  classDead: 'class Wrapper{context=false?ctx:{}};opaque(new Wrapper())',
  arrayAlias: 'const [saved]=[ctx];opaque(saved)',
  objectAlias: 'const {context:saved}={context:ctx};opaque(saved)',
  objectShorthand: 'const {ctx:saved}={ctx};opaque(saved)',
  arrayRest: 'const [...saved]=[ctx];opaque(saved)',
  arrayHole: 'const [saved]=[,];opaque(saved)',
  arrayIndependent: 'const [saved]=[{independent:true}];opaque(saved)',
  arrayUnused: 'const [saved]=[ctx];ctx.assert(true)',
  arrayIgnored: 'function ignore(_value:unknown){};const [saved]=[ctx];ignore(saved)',
  arrayDead: 'const [saved]=[false?ctx:{}];opaque(saved)',
} as const
function fixture(name: keyof typeof controls) {
  return {
    'route.ts': `declare function opaqueTag(strings:TemplateStringsArray,...values:unknown[]):void;${route(`const options={assertAccess:(ctx:Context)=>{${controls[name]}}};`)}`,
  }
}
it.each([
  'tagClosure',
  'tagReturn',
  'classCapture',
  'classExpression',
  'arrayAlias',
  'objectAlias',
  'objectShorthand',
  'arrayRest',
] as const)('rejects selected captured context in %s', (name) => expectUnknown(fixture(name)))
it.each([
  'tagIgnored',
  'tagIndependent',
  'tagDead',
  'classIndependent',
  'classUnused',
  'classDead',
  'arrayIndependent',
  'arrayHole',
  'arrayUnused',
  'arrayIgnored',
  'arrayDead',
] as const)('retains independent or unused captures in %s', (name) =>
  expectNoContent(fixture(name)),
)
