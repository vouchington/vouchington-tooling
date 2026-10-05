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

const callbacks = {
  aliasEmission: 'const cb=()=>ctx.json({bad:true});opaque(cb)',
  aliasConsumed:
    'function consume(callback:()=>void){callback()};const cb=()=>ctx.json({bad:true});consume(cb)',
  aliasChain: 'const cb=()=>ctx.json({bad:true});const selected=cb;opaque(selected)',
  aliasIgnored:
    'function ignore(_callback:()=>void){};const cb=()=>ctx.json({bad:true});ignore(cb)',
  aliasIndependent: 'const other={json(_value:unknown){}};const cb=()=>other.json({});opaque(cb)',
  aliasDead: 'const cb=()=>{if(false)ctx.json({bad:true});ctx.assert(true)};opaque(cb)',
  generatorYield: 'function* expose(){yield ctx};opaque(expose())',
  generatorWrapped: 'function* expose(){yield {context:ctx}};opaque(expose())',
  generatorIgnored:
    'function ignore(_value:unknown){};function* expose(){yield ctx};ignore(expose())',
  generatorNestedUnused:
    'function* expose(){function* nested(){yield ctx};yield 1};opaque(expose())',
  generatorIndependent: 'function* expose(){yield {independent:true}};opaque(expose())',
  generatorDead: 'function* expose(){if(false)yield ctx;yield 1};opaque(expose())',
  generatorUnused: 'function* expose(){yield ctx};ctx.assert(true)',
} as const
const getters = {
  getterMutation:
    'const options={assertAccess:(ctx:Context)=>ctx.assert(true),get scalar(){this.assertAccess=opaque;return 1}};consume(options.scalar)',
  getterElement:
    "const options={assertAccess:(ctx:Context)=>ctx.assert(true),get scalar(){this.assertAccess=opaque;return 1}};consume(options['scalar'])",
  getterIndependent:
    'const options={assertAccess:(ctx:Context)=>ctx.assert(true)};const other={get scalar(){return 1}};consume(other.scalar)',
  primitiveMember:
    'const options={assertAccess:(ctx:Context)=>ctx.assert(true),scalar:1};consume(options.scalar)',
  getterUnused:
    'const options={assertAccess:(ctx:Context)=>ctx.assert(true),get scalar(){this.assertAccess=opaque;return 1}};',
} as const
function fixture(name: string) {
  const callback = callbacks[name as keyof typeof callbacks]
  const setup = callback
    ? `const options={assertAccess:(ctx:Context)=>{${callback}}};`
    : `declare function consume(value:unknown):void;${getters[name as keyof typeof getters]}`
  return { 'route.ts': route(setup) }
}
it.each([
  'aliasEmission',
  'aliasConsumed',
  'aliasChain',
  'generatorYield',
  'generatorWrapped',
  'getterMutation',
  'getterElement',
])('rejects selected capabilities in %s', (name) => expectUnknown(fixture(name)))
it.each([
  'aliasIgnored',
  'aliasIndependent',
  'aliasDead',
  'generatorIndependent',
  'generatorIgnored',
  'generatorNestedUnused',
  'generatorDead',
  'generatorUnused',
  'getterIndependent',
  'primitiveMember',
  'getterUnused',
])('preserves independent or unused capabilities in %s', (name) => expectNoContent(fixture(name)))
