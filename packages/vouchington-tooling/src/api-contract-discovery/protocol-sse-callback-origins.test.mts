import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createSseCallbackOrigins } from './protocol-sse-callback-origins.mts'

let root: string
let checker: ts.TypeChecker
let calls: ts.CallExpression[]
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sse-callback-origins-'))
  const file = join(root, 'controls.ts')
  writeFileSync(
    join(root, 'foreign.ts'),
    `
    class ForeignStream {write(_value:string):void{}}
    function channel(options:{emit:(event:string)=>void}){options.emit('value')}
    export function externalFactory(options:{emit:(stream:ForeignStream,event:string)=>void}){
      return ()=>{const sse={stream:new ForeignStream()};channel({emit:event=>options.emit(sse.stream,event)})}
    }
  `,
  )
  writeFileSync(
    file,
    `
    import {externalFactory} from './foreign'
    class Stream {write(_value:string):void{}}
    declare const app:{route(path:string):{get(handler:()=>void):void}}
    declare function opaque(value:unknown):void
    function channel(options:{emit:(event:string)=>void}){options.emit('value')}
    function factory(options:{emit:(stream:Stream,event:string)=>void}){
      return ()=>{const sse={stream:new Stream()};channel({emit:event=>options.emit(sse.stream,event)})}
    }
    app.route('/safe').get(factory({emit:(stream,event)=>stream.write(event)}))
    app.route('/external').get(externalFactory({emit:(stream,event)=>stream.write(event)}))
    function replaced(options:{emit:(stream:Stream,event:string)=>void}){
      return ()=>{options.emit=()=>{};options.emit(new Stream(),'value')}
    }
    app.route('/replaced').get(replaced({emit:(stream,event)=>stream.write(event)}))
    function escape(options:{emit:(stream:Stream,event:string)=>void}){
      return ()=>{opaque(options);options.emit(new Stream(),'value')}
    }
    app.route('/escape').get(escape({emit:(stream,event)=>stream.write(event)}))
    function unused(options:{emit:(stream:Stream,event:string)=>void}){
      return ()=>{const ignored=()=>options.emit(new Stream(),'value');void ignored}
    }
    app.route('/unused').get(unused({emit:(stream,event)=>stream.write(event)}))
    function defaulted(options:{emit:(stream:Stream,event:string)=>void}={emit:()=>{}}){
      return ()=>options.emit(new Stream(),'value')
    }
    app.route('/default').get(defaulted({emit:(stream,event)=>stream.write(event)}))
    function direct(options:{emit:(stream:Stream,event:string)=>void}){
      return ()=>options.emit(new Stream(),'value')
    }
    app.route('/raw').get(direct({emit:stream=>stream.write('unmarked')}))
    app.route('/leak').get(direct({emit:stream=>{opaque(stream)}}))
    app.route('/callbackDefault').get(direct({emit:(stream=new Stream(),event)=>stream.write(event)}))
    app.route('/callbackRest').get(direct({emit:(...values:[Stream,string])=>values[0].write(values[1])}))
    app.route('/callbackDestructure').get(direct({emit:({write},event)=>write(event)}))
    app.route('/callbackWrite').get(direct({emit:(stream,event)=>{stream=new Stream();stream.write(event)}}))
    function dead(options:{emit:(stream:Stream,event:string)=>void}){
      return ()=>{if(false)options.emit(new Stream(),'value')}
    }
    app.route('/dead').get(dead({emit:(stream,event)=>stream.write(event)}))
    const named=(stream:Stream,event:string)=>stream.write(event)
    app.route('/named').get(direct({emit:named}))
    function local(){return ()=>{const cb=()=>{};cb()}}
    app.route('/local').get(local())
    function lateEscape(options:{emit:(stream:Stream,event:string)=>void}){
      return ()=>{options.emit(new Stream(),'value');opaque(options)}
    }
    app.route('/lateEscape').get(lateEscape({emit:(stream,event)=>stream.write(event)}))
    function handlerDefault(options:{emit:(stream:Stream,event:string)=>void}){
      return (_context=1)=>options.emit(new Stream(),'value')
    }
    app.route('/handlerDefault').get(handlerDefault({emit:(stream,event)=>stream.write(event)}))
    const dynamicRoute='/dynamic'
    app.route(dynamicRoute).get(direct({emit:(stream,event)=>stream.write(event)}))
    export {}
  `,
  )
  const program = ts.createProgram([file], {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
  })
  expect(ts.getPreEmitDiagnostics(program)).toEqual([])
  checker = program.getTypeChecker()
  calls = []
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(program.getSourceFile(file)!)
})
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})
it('binds only actual options callback invocations in supported returned handlers', () => {
  const result = createSseCallbackOrigins(calls, checker)
  expect(result.invocations.map((origin) => origin.binding.routeTemplate)).toEqual([
    '/safe',
    '/external',
    '/raw',
    '/leak',
  ])
  const safe = result.invocations.find((origin) => origin.binding.routeTemplate === '/safe')!
  expect(safe.call.arguments[0]!.getText()).toBe('sse.stream')
  expect(safe.callback.parameters[0]!.name.getText()).toBe('stream')
  expect(result.handlerCalls).toContain(safe.call)
})
it.each([
  '/replaced',
  '/escape',
  '/unused',
  '/default',
  '/callbackDefault',
  '/callbackRest',
  '/callbackDestructure',
  '/callbackWrite',
  '/dead',
  '/named',
  '/local',
  '/lateEscape',
  '/handlerDefault',
  '/dynamic',
])('does not assign a safe origin to %s', (route) =>
  expect(
    createSseCallbackOrigins(calls, checker).invocations.some(
      (origin) => origin.binding.routeTemplate === route,
    ),
  ).toBe(false),
)
it.each(['/raw', '/leak'])(
  'retains actual %s callback bodies for the owning raw-write proof',
  (route) => {
    const origin = createSseCallbackOrigins(calls, checker).invocations.find(
      (value) => value.binding.routeTemplate === route,
    )!
    expect(origin.callback.body!.getText()).toContain(
      route === '/raw' ? "'unmarked'" : 'opaque(stream)',
    )
  },
)
