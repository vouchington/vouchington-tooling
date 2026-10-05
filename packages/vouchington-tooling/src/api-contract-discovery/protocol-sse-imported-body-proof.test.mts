import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createImportedSseBodyProof } from './protocol-sse-imported-body-proof.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'

const sources = {
  foreign: `
    declare function opaque(value:unknown):void
    declare function apiSseFrame(value:string):string
    export class Stream {
      readable=true
      count=0
      write(_value:string):void{}
      end():void{}
      uncertain():void{}
    }
    class Sink {constructor(_stream:Stream){}}
    export function construct(stream:Stream){new Sink(stream)}
    export function remove(stream:Stream){delete (stream as Partial<Stream>).readable}
    export function destructure({stream}:{stream:Stream}){void stream}
    export function nestedSafe(stream:Stream){finish(stream)}
    export function captured(){void streamCapture.readable}
    export function capturedRaw(){streamCapture.write('unmarked')}
    export const streamCapture=new Stream()
    export function ignore(stream:Stream){void stream.readable}
    export function finish(stream:Stream){stream.end()}
    export function raw(stream:Stream){stream.write('unmarked')}
    export function aliasRaw(stream:Stream){const alias=stream;alias.write('unmarked')}
    export function forward(stream:Stream){opaque(stream)}
    export function unknownMethod(stream:Stream){stream.uncertain()}
    export function leak(stream:Stream){return stream}
    export function cycle(stream:Stream){cycle(stream)}
    export function marked(stream:Stream){stream.write(apiSseFrame('GET:/events'))}
    export function start(ctx:any):{stream:Stream}{
      const stream=new Stream();ctx.pipeline(stream);return {stream}
    }
    export function startRaw(ctx:any):{stream:Stream}{
      const stream=new Stream();ctx.pipeline(stream);stream.write('unmarked');return {stream}
    }
    export function startUnknown(ctx:any):{stream:Stream}{
      const stream=new Stream();ctx.pipeline(stream);stream.uncertain();return {stream}
    }
    export function startClosure(ctx:any):{stream:Stream}{
      const stream=new Stream();const callback=()=>stream.write('unmarked');
      ctx.pipeline(stream);void callback;return {stream}
    }
    export function startEnd(ctx:any):{stream:Stream}{
      const stream=new Stream();const callback=()=>stream.end();
      ctx.pipeline(stream);void callback;return {stream}
    }
    class Holder {stream=new Stream()}
    export function path(ctx:any){
      const holder=new Holder();opaque(holder.stream.readable);
      ctx.pipeline(holder.stream);return {stream:holder.stream}
    }
    export function increment(stream:Stream){stream.count++}
    export function assign(stream:Stream){stream.readable=false}
    export function container(stream:Stream){const box={stream};void box}
    export function returnClosure(stream:Stream){const callback=()=>stream;void callback}
    export function spread(stream:Stream){opaque(...([stream] as [Stream]))}
    export function noReturn(ctx:any):void{void ctx}
    export function nonObject(ctx:any):Stream{void ctx;return new Stream()}
    export function missing(ctx:any):{other:Stream}{void ctx;return {other:new Stream()}}
    export function property(ctx:any):{stream:Stream}{
      const local=new Stream();ctx.pipeline(local);return {stream:local}
    }
    export function method(ctx:any){void ctx;return {stream(){return new Stream()}}}
    export function mutation(ctx:any){
      const stream=new Stream();const box={stream};ctx.pipeline(stream);return {stream:box.stream}
    }
    export function spreadReturn(ctx:any){const stream=new Stream();void ctx;return {...{stream}}}
    export function defaulted(stream:Stream=new Stream()){void stream.readable}
    export function rest(...streams:Stream[]){void streams}
  `,
  caller: `
    import {Stream,ignore,finish,raw,aliasRaw,forward,unknownMethod,leak,cycle,
      marked,start,startRaw,startUnknown,startClosure,startEnd,defaulted,rest,
      construct,remove,destructure,nestedSafe,captured,capturedRaw,streamCapture,
      increment,assign,container,returnClosure,spread,noReturn,nonObject,missing,property,method,mutation,spreadReturn,path} from './foreign'
    declare const ctx:any
    const stream=new Stream()
    ignore(stream);finish(stream);raw(stream);aliasRaw(stream);forward(stream)
    unknownMethod(stream);leak(stream);cycle(stream);marked(stream)
    start(ctx);startRaw(ctx);startUnknown(ctx);startClosure(ctx);startEnd(ctx)
    defaulted(stream);rest(stream);construct(stream);remove(stream)
    destructure({stream});nestedSafe(stream);captured();capturedRaw();void streamCapture
    increment(stream);assign(stream);container(stream);returnClosure(stream);spread(stream)
    noReturn(ctx);nonObject(ctx);missing(ctx);property(ctx);method(ctx);mutation(ctx);spreadReturn(ctx);path(ctx)
  `,
} as const

let root: string
let checker: ts.TypeChecker
let calls: Map<string, ts.CallExpression>
let canonical: Set<ts.CallExpression>

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sse-imported-body-'))
  const files = Object.fromEntries(
    Object.entries(sources).map(([name, source]) => {
      const file = join(root, `${name}.ts`)
      writeFileSync(file, `${source}\nexport {}\n`)
      return [name, file]
    }),
  )
  const program = ts.createProgram(Object.values(files), {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
  })
  expect(ts.getPreEmitDiagnostics(program)).toEqual([])
  const foreign = program.getSourceFile(files.foreign!)!
  const caller = program.getSourceFile(files.caller!)!
  checker = program.getTypeChecker()
  calls = new Map()
  canonical = new Set()
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (node.getSourceFile() === caller && ts.isIdentifier(node.expression))
        calls.set(node.expression.text, node)
      if (
        node.getSourceFile() === foreign &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === 'pipeline' ||
          (node.expression.name.text === 'write' &&
            node.arguments.some(
              (argument) =>
                ts.isCallExpression(argument) &&
                ts.isIdentifier(argument.expression) &&
                argument.expression.text === 'apiSseFrame',
            )))
      )
        canonical.add(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(foreign)
  visit(caller)
  expect(calls.size).toBe(35)
  expect(canonical.size).toBe(9)
})
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

function prove(name: string, returnedProperty = false, captured = false): boolean {
  const call = calls.get(name)
  if (!call) throw new Error(`Missing checked invocation ${name}`)
  const helper = createImportedSseBodyProof(
    checker,
    (node) => checker.getResolvedSignature(node)?.declaration,
    (node, selectedReceiver) => {
      if (!canonical.has(node)) return false
      const target =
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'pipeline' &&
        node.arguments[0]
          ? expressionReceiver(node.arguments[0], checker)
          : ts.isPropertyAccessExpression(node.expression)
            ? expressionReceiver(node.expression.expression, checker)
            : undefined
      return !!target && target.root === selectedReceiver.root
    },
  )
  const capture =
    captured &&
    checker
      .getSymbolsInScope(call, ts.SymbolFlags.Value | ts.SymbolFlags.Alias)
      .find((symbol) => symbol.name === 'streamCapture')
  return helper(
    call,
    returnedProperty || captured ? [] : [0],
    returnedProperty ? ['stream'] : [],
    capture ? [{ root: checker.getAliasedSymbol(capture), path: [] }] : [],
  )
}

it.each(['ignore', 'finish', 'marked', 'nestedSafe'])(
  'accepts the reached imported %s implementation with selected-stream proof',
  (name) => expect(prove(name)).toBe(true),
)

it.each([
  'raw',
  'aliasRaw',
  'forward',
  'unknownMethod',
  'leak',
  'cycle',
  'defaulted',
  'rest',
  'construct',
  'remove',
  'destructure',
  'increment',
  'assign',
  'container',
  'returnClosure',
  'spread',
])('rejects the imported %s implementation when selected-stream safety is not proved', (name) =>
  expect(prove(name)).toBe(false),
)

it.each(['start', 'startEnd', 'property', 'path'])(
  'binds the returned stream of imported %s to its local allocation',
  (name) => expect(prove(name, true)).toBe(true),
)

it.each([
  'startRaw',
  'startUnknown',
  'startClosure',
  'noReturn',
  'nonObject',
  'missing',
  'method',
  'mutation',
  'spreadReturn',
])('rejects an unsafe operation on the selected returned stream in %s', (name) =>
  expect(prove(name, true)).toBe(false),
)

it.each([
  ['captured', true],
  ['capturedRaw', false],
] as const)('checks the selected lexical receiver in %s', (name, safe) =>
  expect(prove(name, false, true)).toBe(safe),
)

it('rejects a call without any selected stream roots', () => {
  const helper = createImportedSseBodyProof(
    checker,
    (node) => checker.getResolvedSignature(node)?.declaration,
    () => false,
  )
  expect(helper(calls.get('ignore')!, [])).toBe(false)
})
