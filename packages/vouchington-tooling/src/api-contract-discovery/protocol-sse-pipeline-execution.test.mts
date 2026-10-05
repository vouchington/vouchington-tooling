import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createSseAccountedPipeline } from './protocol-sse-accounted-pipeline.mts'
import { expressionReceiver, writeReceiver } from './protocol-write-receiver.mts'
import { visit } from './response-contract-route-analysis.mts'
import type { BackendResponseContract } from './response-contract-types.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const fixture = (pipeline: string) => `declare const app:any;declare const choose:boolean;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string){return true}}
 function start(ctx:any):{stream:Stream}{const stream=new Stream();${pipeline};return {stream}}
 app.route('/events').get((ctx:any)=>{const sse=start(ctx);
 sse.stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{ok:true}}))})`
const sources = {
  direct: fixture('ctx.pipeline(stream)'),
  labeled: fixture('block:{if(choose)break block;ctx.pipeline(stream)}'),
  nestedlabel: fixture('outer:{inner:{if(choose)break outer;ctx.pipeline(stream)}}'),
  directlabel: fixture('block:{ctx.pipeline(stream)}'),
  deadlabel: fixture('block:{if(false)break block;ctx.pipeline(stream)}'),
  separatelabel: fixture('block:{prior:{if(choose)break prior};ctx.pipeline(stream)}'),
  separateloop: fixture('while(choose){break};ctx.pipeline(stream)'),
  dead: fixture('if(false)return {stream};ctx.pipeline(stream)'),
  local: fixture('function unused(){return stream};ctx.pipeline(stream)'),
  chained: fixture('const result=ctx.pipeline(stream).catch(()=>{})'),
  conditional: fixture('if(choose)ctx.pipeline(stream)'),
  logical: fixture('choose&&ctx.pipeline(stream)'),
  ternary: fixture('choose?ctx.pipeline(stream):undefined'),
  loop: fixture('while(choose){ctx.pipeline(stream);break}'),
  early: fixture('if(choose)return {stream};ctx.pipeline(stream)'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
function accounted(name: keyof typeof sources): boolean {
  const source = matrix.sourceFile(name)
  const checker = matrix.program.getTypeChecker()
  const calls: ts.CallExpression[] = []
  visit(source, (node) => {
    if (ts.isCallExpression(node)) calls.push(node)
  })
  const pipeline = calls.find(
    (call) =>
      ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'pipeline',
  )!
  const invocation = calls.find(
    (call) => ts.isIdentifier(call.expression) && call.expression.text === 'start',
  )!
  const frame = calls.find(
    (call) =>
      ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'write',
  )!
  const fn = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'start',
  )!
  const context = checker.getSymbolAtLocation(fn.parameters[0]!.name)!
  const receiver = writeReceiver(frame, checker)!
  const contract: BackendResponseContract = {
    source: 'fixture',
    schema: { root: { type: 'unknown' }, definitions: {} },
    hash: 'fixture',
    method: 'GET',
    routeTemplate: '/events',
    sseEvents: [
      {
        eventName: 'done',
        contract: {
          source: 'fixture',
          schema: { root: { type: 'unknown' }, definitions: {} },
          hash: 'fixture',
        },
      },
    ],
  }
  const proof = createSseAccountedPipeline(
    calls,
    checker,
    new Map(),
    new Map([['GET:/events', { receivers: [receiver], keys: ['GET:/events'] }]]),
    new Map([['GET:/events', contract]]),
  )
  expect(expressionReceiver(pipeline.arguments[0]!, checker)).toBeDefined()
  return proof(pipeline, context, invocation, invocation)
}
it.each(['conditional', 'logical', 'ternary', 'loop', 'early', 'labeled', 'nestedlabel'] as const)(
  'rejects unproven pipeline execution in %s',
  (name) => expect(accounted(name)).toBe(false),
)
it.each([
  'direct',
  'chained',
  'dead',
  'local',
  'directlabel',
  'deadlabel',
  'separatelabel',
  'separateloop',
] as const)('preserves unconditional pipeline in %s', (name) => expect(accounted(name)).toBe(true))
