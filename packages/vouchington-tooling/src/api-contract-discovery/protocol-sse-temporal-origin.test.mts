import { opaqueArgumentExcludesSelectedStream } from './protocol-sse-opaque-identity.mts'
import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { predatesSelectedSseAllocation } from './protocol-sse-temporal-origin.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `class Stream{write(_value:string):void{}}
  declare function check(actual:unknown,selected:unknown):void;
  function start(){return {stream:new Stream()}}
`
const sources = {
  'conditional-alias': `${preamble}function route(){const {stream}=start();const earlier=Math.random()>0.5?stream:undefined;check(earlier,stream)}`,
  before: `${preamble}function route(){const earlier={};const {stream}=start();check(earlier,stream)}`,
  after: `${preamble}function route(){const {stream}=start();const earlier={};check(earlier,stream)}`,
  module: `${preamble}const earlier={};function route(){const {stream}=start();check(earlier,stream)}`,
  'module-selected': `${preamble}const earlier={};const {stream}=start();check(earlier,stream)`,
  member: `${preamble}function route(){const earlier:{value?:unknown}={};const {stream}=start();earlier.value=stream;check(earlier,stream)}`,
  reflective: `${preamble}function route(){const earlier={};const {stream}=start();Object.defineProperty(earlier,'value',{value:stream});check(earlier,stream)}`,
  destructured: `${preamble}function route(){const earlier={};const {stream}=start();check(earlier,stream)}`,
  assigned: `${preamble}function route(){const earlier={};let owner:{stream:Stream};owner=start();check(earlier,owner.stream)}`,
  'other-scope': `${preamble}function route(){const {stream}=start();function nested(){const earlier={};check(earlier,stream)}nested()}`,
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  expect(ts.getPreEmitDiagnostics(matrix.program)).toEqual([])
})
function receiverFacts(name: keyof typeof sources) {
  const checker = matrix.program.getTypeChecker()
  let call: ts.CallExpression | undefined
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.getText() === 'check') call = node
    ts.forEachChild(node, visit)
  }
  visit(matrix.sourceFile(name))
  const actual = expressionReceiver(call!.arguments[0]!, checker)!
  const selected = expressionReceiver(call!.arguments[1]!, checker)!
  return { call: call!, actual, selected, checker }
}
function independent(name: keyof typeof sources): boolean {
  const { actual, selected, checker } = receiverFacts(name)
  return predatesSelectedSseAllocation(actual, selected, checker)
}
it.each(['before', 'module', 'destructured', 'assigned'] as const)(
  'proves an unmodified earlier origin in %s',
  (name) => expect(independent(name)).toBe(true),
)
it.each(['after', 'member', 'reflective', 'other-scope', 'module-selected'] as const)(
  'does not grant temporal independence in %s',
  (name) => expect(independent(name)).toBe(false),
)

it('rejects an actual conditional alias before applying temporal exclusions', () => {
  const { call, actual, selected, checker } = receiverFacts('conditional-alias')
  expect(
    opaqueArgumentExcludesSelectedStream(call, call.arguments[0]!, actual, [selected], checker),
  ).toBe(false)
})
