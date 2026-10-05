import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { handlerNodes } from './registered-route-handler-analysis.mts'
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
  conditional: 'opaque(choose?ctx:{})',
  wrappedConditional: 'opaque(choose?{context:ctx}:{})',
  logicalAnd: 'opaque(choose&&ctx)',
  logicalOr: 'opaque(choose||ctx)',
  nullish: 'declareValue(ctx)',
  comma: 'opaque((ctx.assert(true),ctx))',
  deadConditional: 'opaque(false?ctx:{})',
  deadOtherConditional: 'opaque(true?{}:ctx)',
  deadAnd: 'opaque(false&&ctx)',
  deadOr: 'opaque(true||ctx)',
  independentComma: 'opaque((ctx.assert(true),{}))',
  ignoredConditional: 'function ignore(_value:unknown){};ignore(choose?ctx:{})',
} as const
const factories = {
  defaultRegisteredUndefined: 'factory(undefined)',
  defaultRegisteredOmitted: 'factory()',
  defaultUndefined: 'factory(undefined)',
  defaultOmitted: 'factory()',
  defaultConcrete: 'factory({assertAccess:(ctx:Context)=>ctx.assert(true)})',
  defaultShadowed: '((undefined:Options)=>factory(undefined))({assertAccess:opaque})',
  defaultUnknown: 'factory(unknownOptions)',
  defaultMutation: 'factory(undefined)',
} as const
function fixture(name: string) {
  const callback = callbacks[name as keyof typeof callbacks]
  if (callback)
    return {
      'route.ts': `declare const choose:boolean;declare const value:{}|null;
 function declareValue(ctx:any){opaque(value??ctx)};${route(`const options={assertAccess:(ctx:Context)=>{${callback}}};`)}`,
    }
  if (name.startsWith('defaultRegistered'))
    return {
      'route.ts': `declare const app:any;
 declare function apiNoContent(key:string):void;
 function factory(callback:(ctx:any)=>void=(ctx)=>ctx.assert(true)){
 return(ctx:any)=>{callback(ctx);ctx.setStatus(204)}}
 const handler=${factories[name as keyof typeof factories]};
 app.route('/vote').put((ctx:any)=>{apiNoContent('PUT:/vote');handler(ctx)});export {};`,
    }
  const mutation =
    name === 'defaultMutation' ? 'Object.assign(defaultOptions,{assertAccess:opaque});' : ''
  return {
    'route.ts': `${preamble.replace('function factory(options:Options)', 'function factory(options:Options=defaultOptions)')}
 declare const unknownOptions:Options|undefined;
 const defaultOptions={assertAccess:(ctx:Context)=>ctx.assert(true)};${mutation}
 const handler=${factories[name as keyof typeof factories]};
 app.route('/vote').put((ctx:Context)=>{apiNoContent('PUT:/vote');handler(ctx)});export {};`,
  }
}
it.each([
  'conditional',
  'wrappedConditional',
  'logicalAnd',
  'logicalOr',
  'nullish',
  'comma',
  'defaultShadowed',
  'defaultUnknown',
  'defaultMutation',
])('rejects selected or unknown capabilities in %s', (name) => expectUnknown(fixture(name)))
it.each([
  'deadConditional',
  'deadOtherConditional',
  'deadAnd',
  'deadOr',
  'independentComma',
  'ignoredConditional',
  'defaultRegisteredUndefined',
  'defaultRegisteredOmitted',
  'defaultUndefined',
  'defaultOmitted',
  'defaultConcrete',
])('retains safe effective results in %s', (name) => expectNoContent(fixture(name)))

it.each([
  'factory()',
  'factory(undefined)',
  'factory(supplied)',
  'factory(...suppliedArguments)',
  'shadowed',
])('resolves actual returned callback defaults for %s', (invocation) => {
  const program = checkedProgram({
    'route.ts': `declare const app:any;declare const supplied:(ctx:any)=>void;
 declare const suppliedArguments:[(ctx:any)=>void,(ctx:any)=>void];
 function factory(callback:(ctx:any)=>void=(ctx)=>ctx.assert(true),selected=callback){return selected}
 ${invocation === 'shadowed' ? 'function shadow(undefined:(ctx:any)=>void){' : ''}
 app.route('/vote').put(${invocation === 'shadowed' ? 'factory(undefined)' : invocation});
 ${invocation === 'shadowed' ? '}' : ''}export {};`,
  })
  const source = program.getSourceFile('/virtual/route.ts')!
  let call: ts.CallExpression | undefined
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'factory'
    )
      call = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(call).toBeDefined()
  const selected = handlerNodes(call!, program.getTypeChecker(), new Map(), new Set(), true)
  if (
    invocation === 'factory(supplied)' ||
    invocation === 'factory(...suppliedArguments)' ||
    invocation === 'shadowed'
  )
    expect(selected).toEqual([])
  else {
    expect(selected).toHaveLength(1)
    expect(selected[0]?.getText()).toBe('(ctx)=>ctx.assert(true)')
  }
})
