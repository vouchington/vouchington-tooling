import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { importedSseCallSafe } from './protocol-sse-imported-call.mts'
import { createSseWriteLookup } from './protocol-sse-write-helpers.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'

const binding = { method: 'GET', routeTemplate: '/events' }
const route = (helper: string, body = '') => `
  import {start,startRaw,ignore,invoke,invokePair,raw,emit,apiSseFrame} from './foreign'
  declare const app:any
  app.route('/events').get((ctx:any)=>{
    const {stream}=${helper}(ctx);
    ${body}
    stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))
  })`
const sources = {
  factory: route('start'),
  rawFactory: route('startRaw'),
  restFactory: route('start')
    .replace('const {stream}=', 'const {...holder}=')
    .replace('stream.write(', 'holder.stream.write('),
  ignoredCapture: route('start', 'ignore(()=>stream)'),
  returnedCapture: route('start', 'invoke(()=>stream)'),
  rawCapture: route('start', "invoke(()=>{stream.write('raw')})"),
  markedCapture: route(
    'start',
    "invoke(()=>{stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))})",
  ),
  independent: route('start', 'ignore({value:1})'),
  directRaw: route('start', 'raw(stream)'),
  markedEmitter: route('start', 'emit(stream)'),
  returnedPair: route('start', 'invokePair(()=>stream,()=>{})'),
  stored: route('start', '(globalThis as any).saved=stream;ignore({value:1})'),
  externalHandler: `import {handler,apiSseFrame} from './foreign';declare const app:any;
    app.route('/events').get(handler({emit:stream=>stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))}))`,
  externalRawHandler: `import {handler,apiSseFrame} from './foreign';declare const app:any;
    app.route('/events').get(handler({emit:stream=>{stream.write('raw');stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))}}))`,
  foreign: `
    class Stream {write(_value:string):void{}}
    export function start(ctx:any){const stream=new Stream();ctx.pipeline(stream);return {stream}}
    export function startRaw(ctx:any){const stream=new Stream();ctx.pipeline(stream);stream.write('raw');return {stream}}
    export function handler(options:{emit:(stream:Stream)=>void}){
      return (ctx:any)=>{const {stream}=start(ctx);options.emit(stream)}
    }
    export function ignore(_value:unknown):void{}
    export function invoke(callback:()=>unknown):void{callback()}
    export function invokePair(first:()=>unknown,second:()=>unknown):void{first();second()}
    export function raw(stream:Stream):void{stream.write('raw')}
    export function emit(stream:Stream):void{stream.write(apiSseFrame('GET:/events',{event:'done',data:{}}))}
    export function apiSseFrame<K extends string,const T>(_key:K,event:T):string{return JSON.stringify(event)}
  `,
} as const
let root: string
let program: ts.Program
let files: Record<keyof typeof sources, string>
beforeAll(() => {
  root = mkdtempSync(join(process.cwd(), 'packages/vouchington-tooling/.sse-imported-call-'))
  files = Object.fromEntries(
    Object.entries(sources).map(([name, source]) => {
      const file = join(root, `${name}.ts`)
      writeFileSync(file, `${source}\nexport {}\n`)
      return [name, file]
    }),
  ) as Record<keyof typeof sources, string>
  program = ts.createProgram(Object.values(files), {
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([])
})
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})
function proof(
  name: Exclude<keyof typeof sources, 'foreign'>,
  helper: string,
  includeForeign = false,
): boolean {
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(files[name])!
  const calls: ts.CallExpression[] = []
  let selected: ts.Expression | undefined
  const framed = new Set<ts.CallExpression>()
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      calls.push(node)
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'write' &&
        node.arguments.some(
          (argument) =>
            ts.isCallExpression(argument) &&
            ts.isIdentifier(argument.expression) &&
            argument.expression.text === 'apiSseFrame',
        )
      ) {
        framed.add(node)
        selected ??= node.expression.expression
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const call = calls.find(
    (node) => ts.isIdentifier(node.expression) && node.expression.text === helper,
  )!
  const receiver = expressionReceiver(selected!, checker)!
  if (includeForeign) visit(program.getSourceFile(files.foreign)!)
  const lookup = createSseWriteLookup(calls, checker, new Map(), [source])
  expect(lookup.implementationCall(call)).toBeUndefined()
  expect(lookup.actualImplementationCall(call)).toBeDefined()
  return importedSseCallSafe(call, [receiver], binding, checker, lookup, framed)
}
it.each([
  ['factory', 'start'],
  ['ignoredCapture', 'ignore'],
  ['markedCapture', 'invoke'],
  ['independent', 'ignore'],
] as const)('proves the exact imported %s helper capability', (name, helper) => {
  expect(proof(name, helper)).toBe(true)
  expect(
    discoverApiResponseContracts(program, [program.getSourceFile(files[name])!], undefined, {
      onRouteError: () => {},
    })['GET:/events']?.unavailableReason,
  ).toBeUndefined()
})
it.each([
  ['rawFactory', 'startRaw'],
  ['returnedCapture', 'invoke'],
  ['rawCapture', 'invoke'],
  ['directRaw', 'raw'],
  ['returnedPair', 'invokePair'],
  ['restFactory', 'start'],
] as const)('rejects an unproved imported %s capability', (name, helper) => {
  expect(proof(name, helper)).toBe(false)
  expect(
    discoverApiResponseContracts(program, [program.getSourceFile(files[name])!], undefined, {
      onRouteError: () => {},
    })['GET:/events']?.unavailableReason,
  ).toBe(
    name === 'restFactory'
      ? 'SSE frame uses a mutable stream alias'
      : 'SSE route writes an unmarked frame',
  )
})

it('accepts a concrete imported emitter only with its exact canonical frame call evidence', () => {
  expect(proof('markedEmitter', 'emit', true)).toBe(true)
  expect(proof('markedEmitter', 'emit')).toBe(false)
})

it.each([
  ['externalHandler', undefined],
  ['externalRawHandler', 'SSE route writes an unmarked frame'],
] as const)('discovers the exact imported returned handler in %s', (name, unavailable) => {
  expect(
    discoverApiResponseContracts(program, [program.getSourceFile(files[name])!], undefined, {
      onRouteError: () => {},
    })['GET:/events']?.unavailableReason,
  ).toBe(unavailable)
})

it('requires the selected fresh origin to remain unexposed before proving an unrelated call', () => {
  expect(proof('stored', 'ignore')).toBe(false)
})
it('leaves an explicitly indexed factory implementation to the indexed proof', () => {
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(files.factory)!
  let call: ts.CallExpression | undefined
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'start'
    )
      call = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  const lookup = createSseWriteLookup([call!], checker, new Map(), [
    program.getSourceFile(files.foreign)!,
  ])
  expect(lookup.implementationCall(call!)).toBeDefined()
  expect(importedSseCallSafe(call!, [], binding, checker, lookup, new Set())).toBe(false)
})
