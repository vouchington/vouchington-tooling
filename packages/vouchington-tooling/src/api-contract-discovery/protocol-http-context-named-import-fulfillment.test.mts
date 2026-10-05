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

const moduleType = "typeof import('./options.js')"
const controls = {
  namedWrite: `function mutate(module:${moduleType}){module.options.assertAccess=opaque}
    import('./options.js').then(mutate)`,
  aliasedWrite: `function mutate(module:${moduleType}){module.options.assertAccess=opaque}
    const selected=mutate;import('./options.js').then(selected)`,
  arrowWrite: `const mutate=(module:${moduleType})=>{module.options.assertAccess=opaque};
    import('./options.js').then(mutate)`,
  destructuredWrite: `function mutate({options}:${moduleType}){options.assertAccess=opaque}
    import('./options.js').then(mutate)`,
  namedRead: `function read(module:${moduleType}){void module.options.assertAccess}
    import('./options.js').then(read)`,
  independentExport: `function mutate(module:${moduleType}){module.other.assertAccess=opaque}
    import('./options.js').then(mutate)`,
  independentPromise: `function mutate(module:${moduleType}){module.options.assertAccess=opaque}
    Promise.resolve({options:{assertAccess:opaque},other:{assertAccess:opaque}}).then(mutate)`,
  rejectionCallback: `function mutate(module:${moduleType}){module.options.assertAccess=opaque}
    import('./options.js').then(undefined,mutate)`,
  ordinaryCall: `function mutate(module:${moduleType}){module.options.assertAccess=opaque}
    mutate({options:{assertAccess:opaque},other:{assertAccess:opaque}})`,
} as const

function files(name: keyof typeof controls) {
  return {
    'options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};
      export const other={assertAccess:(ctx:any)=>ctx.assert(true)};`,
    'consumer.ts': `declare const opaque:(ctx:any)=>void;${controls[name]};export {};`,
    'route.ts': `import {options} from './options.js';${route('')}`,
  }
}

it.each(['namedWrite', 'aliasedWrite', 'arrowWrite', 'destructuredWrite'] as const)(
  'rejects selected callback writes through named import fulfillment: %s',
  (name) => expectUnknown(files(name)),
)
it.each([
  'namedRead',
  'independentExport',
  'independentPromise',
  'rejectionCallback',
  'ordinaryCall',
] as const)('retains safe named module callbacks: %s', (name) => expectNoContent(files(name)))
