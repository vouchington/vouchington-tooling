import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { selectedStaticSseClassCapability } from './protocol-sse-static-class-values.mts'
import { selectedSseCallableCapture } from './protocol-sse-wrapper-captures.mts'
import { isProtocolCallbackFunction } from './protocol-callback-values.mts'
import { someSseArgumentValue } from './protocol-sse-literal-arguments.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const source = (expression: string) => `class Stream {write(_value:string):void{}};
 const stream=new Stream();const other=new Stream();const escaped=${expression};export {};`
const sources = {
  field: source('class {static value=stream}'),
  nested: source('class {static value={stream}}'),
  block: source('class {static value:unknown;static {this.value=stream}}'),
  blockcall: source('class {static {stream.write("unframed")}}'),
  callback: source('class {static emit=()=>stream.write("unframed")}'),
  independent: source('class {static value=other}'),
  independentblock: source('class {static value:unknown;static {this.value=other}}'),
  metadata: source('class {static value:unknown;static {const label="meta";this.value=label}}'),
  deadfield: source('class {static value=false?stream:other}'),
  nesteddeadfield: source('class {static value={value:false?stream:other}}'),
  metadataobject: source('class {static value={name:"meta",value:other}}'),
  metadataarray: source('class {static value=["meta",other]}'),
  deadblock: source('class {static value:unknown;static {if(false)this.value=stream}}'),
  instance: source('class {value=other}'),
  nonclass: source('({value:other})'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  expect(ts.getPreEmitDiagnostics(matrix.program)).toEqual([])
})
function capture(name: keyof typeof sources) {
  const file = matrix.sourceFile(name)
  const checker = matrix.program.getTypeChecker()
  const declarations = file.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
  const selected = checker.getSymbolAtLocation(
    declarations.find((value) => value.name.getText() === 'stream')!.name,
  )!
  const escaped = declarations.find((value) => value.name.getText() === 'escaped')!.initializer!
  const direct = (value: ts.Expression) => {
    const receiver = expressionReceiver(value, checker)
    return receiver?.root === selected && receiver.path.length === 0
  }
  const matches = (value: ts.Expression) => someSseArgumentValue(value, checker, direct)
  return selectedStaticSseClassCapability(
    escaped,
    matches,
    (fn) => isProtocolCallbackFunction(fn) && selectedSseCallableCapture(fn, matches),
  )
}
it.each(['field', 'nested', 'block', 'blockcall', 'callback'] as const)(
  'captures selected static stream: %s',
  (name) => expect(capture(name)).toBe(true),
)
it.each([
  'independent',
  'independentblock',
  'metadata',
  'deadfield',
  'nesteddeadfield',
  'metadataobject',
  'metadataarray',
  'deadblock',
  'instance',
  'nonclass',
] as const)('keeps independent or unexecuted class values: %s', (name) =>
  expect(capture(name)).toBe(false),
)
