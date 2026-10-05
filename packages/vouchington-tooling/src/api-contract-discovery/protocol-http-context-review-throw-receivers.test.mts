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
  thrown: 'try{throw ctx}catch(saved){opaque(saved)}',
  thrownWrapped: 'try{throw {saved:ctx}}catch(saved){opaque(saved)}',
  thrownIndependent: 'try{throw {independent:true}}catch(saved){opaque(saved)}',
  thrownDead: 'if(false){throw ctx};ctx.assert(true)',
  receiver: 'if(options.assertAccess)[ctx].forEach(options.assertAccess)',
  receiverWrapped: 'if(options.assertAccess)[{saved:ctx}].forEach(value=>opaque(value))',
  receiverIndependent: '[{independent:true}].forEach(value=>opaque(value))',
  receiverIgnored: '({saved:ctx,ignore(){}}).ignore()',
  receiverCaptures: '({saved:ctx,consume(){ctx.json({bad:true})}}).consume()',
  receiverThis: '({saved:ctx,consume(){opaque(this.saved)}}).consume()',
} as const
const fixture = (name: keyof typeof controls) => ({
  'route.ts': route(
    `const options:Options={assertAccess(ctx){ctx.json({bad:true})}};const selected={assertAccess:(ctx:Context)=>{${controls[name]}}};`,
    'selected',
  ),
})
it.each([
  'thrown',
  'thrownWrapped',
  'receiver',
  'receiverWrapped',
  'receiverCaptures',
  'receiverThis',
] as const)('rejects selected context transported through %s', (name) =>
  expectUnknown(fixture(name)),
)
it.each(['thrownIndependent', 'thrownDead', 'receiverIndependent', 'receiverIgnored'] as const)(
  'retains independent or ignored transport in %s',
  (name) => expectNoContent(fixture(name)),
)
