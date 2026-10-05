import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createSseWriteLookup } from './protocol-sse-write-helpers.mts'
import { buildVirtualProgramMatrix } from './test-setup.test-helpers.mts'

let checker: ts.TypeChecker
let calls: ts.CallExpression[]
const source = `declare const app:{route(path:string):{get(handler:()=>void):void}};
  class Stream {write(_value:string):void{}}
  function factory(options:{emit:(stream:Stream,event:string)=>void}){
    return ()=>{const stream=new Stream();options.emit(stream,'event')}
  }
  app.route('/first').get(factory({emit:(stream,event)=>stream.write(event)}));
  app.route('/second').get(factory({emit:(stream,event)=>stream.write(event)}));
  export {}`
beforeAll(() => {
  const matrix = buildVirtualProgramMatrix(import.meta, { lookup: source })
  expect(ts.getPreEmitDiagnostics(matrix.program)).toEqual([])
  checker = matrix.program.getTypeChecker()
  calls = []
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(matrix.sourceFile('lookup'))
})
it('resolves a shared factory callback only for its selected registered route', () => {
  const lookup = createSseWriteLookup(calls, checker, new Map())
  const invocation = calls.find((call) => call.expression.getText() === 'options.emit')!
  const first = lookup.actualImplementationCall(invocation, {
    method: 'GET',
    routeTemplate: '/first',
  })
  const second = lookup.actualImplementationCall(invocation, {
    method: 'GET',
    routeTemplate: '/second',
  })
  expect(first && ts.isArrowFunction(first)).toBe(true)
  expect(second && ts.isArrowFunction(second)).toBe(true)
  expect(first).not.toBe(second)
  expect(lookup.actualImplementationCall(invocation)).toBeUndefined()
  expect(
    lookup.actualImplementationCall(invocation, { method: 'GET', routeTemplate: '/unknown' }),
  ).toBeUndefined()
  expect(lookup.reachableCalls()).toContain(invocation)
})
