import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { expressionReceiver, sameWriteReceiver } from './protocol-write-receiver.mts'
import { selectedSseWrapperCapture } from './protocol-sse-wrapper-captures.mts'
import { selectedReturnedSseCapability } from './protocol-sse-returned-capability.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const fixture = (body: string) => `declare function opaque(value:unknown):void;
  class Stream{write(_value:string):void{}}
  const stream=new Stream();const other=new Stream();${body}`
const sources = {
  'selected-class': fixture('opaque(class {static expose=()=>stream})'),
  'selected-class-write': fixture("opaque(class {static emit=()=>stream.write('raw')})"),
  'independent-class': fixture('opaque(class {static expose=()=>other})'),
  'independent-class-write': fixture("opaque(class {static emit=()=>other.write('log')})"),
  'callable-cycle': fixture(`function first():unknown{return second()}
    function second():unknown{return first()};const alias=first;opaque(alias())`),
  'container-cycle': fixture(`function build(){const box:{self?:unknown}={};
    box.self=box;return box}opaque(build())`),
  'dead-selected-return': fixture('function build(){return false?stream:other};opaque(build())'),
  'executed-selected-return': fixture('function build(){return true?stream:other};opaque(build())'),
  'independent-return': fixture('function build(){return {other}};opaque(build())'),
  'independent-stored-return': fixture(`function build(){const box:{value?:Stream}={};
    box.value=other;return box}opaque(build())`),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
function origin(name: keyof typeof sources) {
  const source = matrix.sourceFile(name)
  const checker = matrix.program.getTypeChecker()
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((value) => ts.isIdentifier(value.name) && value.name.text === 'stream')
  const frame =
    declaration &&
    ts.isIdentifier(declaration.name) &&
    expressionReceiver(declaration.name, checker)
  const call = source.statements
    .filter(ts.isExpressionStatement)
    .map((statement) => statement.expression)
    .find(
      (value) =>
        ts.isCallExpression(value) &&
        ts.isIdentifier(value.expression) &&
        value.expression.text === 'opaque',
    )
  if (!frame || !call || !ts.isCallExpression(call) || !call.arguments[0])
    throw new Error('Missing actual selected allocation or consumer')
  return { checker, frame, argument: call.arguments[0] }
}
it.each([
  ['selected-class', true],
  ['selected-class-write', true],
  ['independent-class', false],
  ['independent-class-write', false],
] as const)('retains actual static callable capability for %s', (name, expected) => {
  const { checker, frame, argument } = origin(name)
  expect(
    selectedSseWrapperCapture(argument, checker, (value) => {
      const receiver = expressionReceiver(value, checker)
      return !!receiver && sameWriteReceiver(frame, receiver)
    }),
  ).toBe(expected)
})
it.each([
  ['selected-class', true],
  ['selected-class-write', true],
  ['independent-class', false],
  ['independent-class-write', false],
  ['callable-cycle', true],
  ['container-cycle', true],
  ['dead-selected-return', false],
  ['executed-selected-return', true],
  ['independent-return', false],
  ['independent-stored-return', false],
] as const)('retains selected or indeterminate returned capability for %s', (name, expected) => {
  const { checker, frame, argument } = origin(name)
  expect(
    selectedReturnedSseCapability(
      argument,
      checker,
      (call) => checker.getResolvedSignature(call)?.declaration,
      [frame],
      (receiver) => [receiver],
    ),
  ).toBe(expected)
})
