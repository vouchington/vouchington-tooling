import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

const preamble = `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare function opaque(value:any):void;
  type Options={assertAccess?:(ctx:any)=>void};
  function factory(options:Options){return (ctx:any)=>{
    if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}`
const route = (setup: string) => `${preamble}
  ${setup}
  app.route('/vote').put((ctx:any)=>{
    apiNoContent('PUT:/vote');const handler=factory(options);handler(ctx)})
  export {}`
const callback = `const options={assertAccess:(ctx:any)=>ctx.assert(true)};`
const sharedRoutes = (order: readonly ('safe' | 'unsafe')[]) => `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare const opaque:()=>void;
  type Options={assertAccess?:(ctx:any)=>void;mutate:()=>void};
  function factory(options:Options){return(ctx:any)=>{
    options.mutate();if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}
  const safeOptions={assertAccess:(ctx:any)=>ctx.assert(true),mutate:()=>{}};
  const unsafeOptions={assertAccess:(ctx:any)=>ctx.assert(true),mutate:opaque};
  ${order
    .map(
      (kind) => `app.route('/${kind}').put((ctx:any)=>{
      apiNoContent('PUT:/${kind}');const handler=factory(${kind}Options);handler(ctx)})`,
    )
    .join('\n')}
  export {}`
const sources = {
  'options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
  'namespace-options.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
  'barrel.ts': `export {options} from './options.js';`,
  'imported-write.ts': route(`import {options} from './options.js';options.assertAccess=opaque;`),
  'imported-escape.ts': route(`import {options} from './options.js';opaque(options);`),
  'barrel-write.ts': route(`import {options} from './barrel.js';options.assertAccess=opaque;`),
  'barrel-escape.ts': route(`import {options} from './barrel.js';opaque(options);`),
  'namespace-write.ts': route(
    `import {options} from './namespace-options.js';
     import * as bucket from './namespace-options.js';
     bucket.options.assertAccess=opaque;`,
  ),
  'object-assignment.ts': route(
    `${callback}({assertAccess:options.assertAccess}={assertAccess:opaque});`,
  ),
  'array-assignment.ts': route(`${callback}[options.assertAccess]=[opaque];`),
  'method-write.ts': route(
    `const options={assertAccess:(ctx:any)=>ctx.assert(true),
      mutate(){this.assertAccess=opaque}};options.mutate();`,
  ),
  'named-exposure.ts': route(`${callback}function expose(){return options}opaque(expose());`),
  'named-call-exposure.ts': route(
    `function makeOptions(){return {assertAccess:(ctx:any)=>ctx.assert(true)}}
     const options=makeOptions();function expose(){return options}opaque(expose());`,
  ),
  'named-local-wrapper-exposure.ts': route(
    `${callback}function expose(){const local={options};return local}opaque(expose());`,
  ),
  'forwarded-wrapper-exposure.ts': route(
    `${callback}function wrap(options:Options){const local={options};return local}
     const wrapped=wrap(options);opaque(wrapped);`,
  ),
  'opaque-receiver.ts': route(
    `declare const mutate:()=>void;
     const options={assertAccess:(ctx:any)=>ctx.assert(true),mutate};options.mutate();`,
  ),
  'immutable-control.ts': route(callback),
  'arrow-receiver-control.ts': route(
    `${callback}options.assertAccess({assert(_value:boolean){}});`,
  ),
  'fresh-local-options-control.ts': route(
    `function makeOptions(){const local={assertAccess:(ctx:any)=>ctx.assert(true)};
     return local}const options=makeOptions();`,
  ),
  'shared-safe-first.ts': sharedRoutes(['safe', 'unsafe']),
  'shared-unsafe-first.ts': sharedRoutes(['unsafe', 'safe']),
  'nested-receiver-opaque.ts': `declare const app:any;
    declare function apiNoContent(key:string):void;
    declare const opaque:()=>void;
    type Options={callback:(ctx:any)=>void;mutate:()=>void};
    function getFn(inner:Options){inner.mutate();return inner.callback}
    function factory(options:Options){return(ctx:any)=>{
      getFn(options)(ctx);ctx.setStatus(204)}}
    const options={callback:(ctx:any)=>ctx.assert(true),mutate:opaque};
    app.route('/nested').put((ctx:any)=>{
      apiNoContent('PUT:/nested');const handler=factory(options);handler(ctx)})
    export {}`,
} as const
type SourceName = keyof typeof sources
let program: ts.Program

function source(name: SourceName): ts.SourceFile {
  const file = program.getSourceFile(`/virtual/${name}`)
  if (!file) throw new Error(`Missing source ${name}`)
  return file
}

function contract(name: Exclude<SourceName, 'options.ts' | 'namespace-options.ts' | 'barrel.ts'>) {
  return discoverApiResponseContracts(program, [source(name)], new Set(['PUT:/vote']))['PUT:/vote']
}

describe('HTTP callback proof observes consumer writes and exposures', () => {
  beforeAll(() => {
    const options: ts.CompilerOptions = {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    }
    const host = ts.createCompilerHost(options, true)
    const texts = new Map(Object.entries(sources).map(([name, text]) => [`/virtual/${name}`, text]))
    const readSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (name, languageVersion, onError, createNew) => {
      const content = texts.get(name)
      return content === undefined
        ? readSourceFile(name, languageVersion, onError, createNew)
        : ts.createSourceFile(name, content, languageVersion, true, ts.ScriptKind.TS)
    }
    const fileExists = host.fileExists.bind(host)
    host.fileExists = (name) => texts.has(name) || fileExists(name)
    const directoryExists = host.directoryExists?.bind(host)
    host.directoryExists = (name) => name === '/virtual' || !!directoryExists?.(name)
    const readFile = host.readFile.bind(host)
    host.readFile = (name) => texts.get(name) ?? readFile(name)
    program = ts.createProgram([...texts.keys()], options, host)
    expect(ts.getPreEmitDiagnostics(program)).toEqual([])
  })

  it.each([
    'immutable-control.ts',
    'arrow-receiver-control.ts',
    'fresh-local-options-control.ts',
  ] as const)('retains a callback that remains concrete in %s', (name) => {
    const row = contract(name)
    expect(row?.unavailableReason).toBeUndefined()
    expect(responseStatusCodesForContract(row!)).toEqual([204])
  })

  it.each([
    'imported-write.ts',
    'imported-escape.ts',
    'barrel-write.ts',
    'barrel-escape.ts',
    'namespace-write.ts',
    'object-assignment.ts',
    'array-assignment.ts',
    'method-write.ts',
    'named-exposure.ts',
    'named-call-exposure.ts',
    'named-local-wrapper-exposure.ts',
    'forwarded-wrapper-exposure.ts',
    'opaque-receiver.ts',
  ] as const)('rejects uncertain callback after %s', (name) => {
    const row = contract(name)
    expect(row?.statusKnowledge).toBe('unknown')
    expect(row?.unavailableReason).toBeTruthy()
  })

  it.each(['shared-safe-first.ts', 'shared-unsafe-first.ts'] as const)(
    'keeps each factory receiver proof separate in %s',
    (name) => {
      for (const keys of [
        ['PUT:/safe', 'PUT:/unsafe'],
        ['PUT:/unsafe', 'PUT:/safe'],
      ]) {
        const rows = discoverApiResponseContracts(program, [source(name)], new Set(keys))
        expect(rows['PUT:/safe']?.unavailableReason).toBeUndefined()
        expect(responseStatusCodesForContract(rows['PUT:/safe']!)).toEqual([204])
        expect(rows['PUT:/unsafe']?.statusKnowledge).toBe('unknown')
        expect(rows['PUT:/unsafe']?.unavailableReason).toBeTruthy()
      }
    },
  )

  it('rejects a callback returned after an opaque nested receiver call', () => {
    const rows = discoverApiResponseContracts(
      program,
      [source('nested-receiver-opaque.ts')],
      new Set(['PUT:/nested']),
    )
    expect(rows['PUT:/nested']?.statusKnowledge).toBe('unknown')
    expect(rows['PUT:/nested']?.unavailableReason).toBeTruthy()
  })
})
