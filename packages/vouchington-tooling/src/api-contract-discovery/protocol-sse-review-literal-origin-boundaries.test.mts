import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { expressionReceiver } from './protocol-write-receiver.mts'
import { selectedOpaqueSseReceiver } from './protocol-sse-returned-capability.mts'
import { someSseArgumentValue } from './protocol-sse-literal-arguments.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
const route = (body: string) => `declare const app:any;declare function opaque(value:unknown):void;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream{write(_value:string):void{}}const stream=new Stream();const other=new Stream();
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  repeated: route(
    'function ignore(_value:unknown){}const value={other};ignore({first:value,second:value})',
  ),
  ambientrepeated: route('const value={other};opaque({first:value,second:value})'),
  alias: route('const wrapper={stream};opaque(wrapper)'),
  chain: route('const wrapper={stream};const next=wrapper;opaque(next)'),
  array: route('const wrapper=[stream];opaque(wrapper)'),
  receiver: route('[stream].forEach(opaque)'),
  receiveralias: route('const wrapper=[stream];wrapper.forEach(opaque)'),
  getter: route('const wrapper={get expose(){return stream}};opaque(wrapper.expose)'),
  getterelement: route("const wrapper={get expose(){return stream}};opaque(wrapper['expose'])"),
  independentalias: route('function ignore(_value:unknown){}const wrapper={other};ignore(wrapper)'),
  ambientalias: route('const wrapper={other};opaque(wrapper)'),
  independentarray: route('function ignore(_value:unknown){}const wrapper=[other];ignore(wrapper)'),
  ambientarray: route('const wrapper=[other];opaque(wrapper)'),
  ambientreceiver: route('[other].forEach(opaque)'),
  independentreceiver: route('function ignore(_value:unknown){}[other].forEach(ignore)'),
  independentgetter: route('const wrapper={get expose(){return other}};opaque(wrapper.expose)'),
  scalargetter: route('const wrapper={get expose(){return 1}};opaque(wrapper.expose)'),
  unusedgetter: route('const wrapper={get expose(){return stream}}'),
  ignoredalias: route('const wrapper={stream};function ignore(_value:unknown){}ignore(wrapper)'),
  otherproperty: route('const wrapper={get expose(){return stream},other:1};opaque(wrapper.other)'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']
it.each([
  'alias',
  'chain',
  'array',
  'receiver',
  'receiveralias',
  'getter',
  'getterelement',
] as const)('rejects actual selected origin in %s', (name) =>
  expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'repeated',
  'independentalias',
  'independentarray',
  'independentreceiver',
  'independentgetter',
  'scalargetter',
  'unusedgetter',
  'ignoredalias',
  'otherproperty',
] as const)('preserves independent origin in %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)

it('fails closed on an actual unchecked JavaScript literal alias cycle', () => {
  // The source has runtime TDZ semantics; analysis must terminate without invented compiler nodes.
  const name = '/virtual/literal-cycle.js'
  const content = 'const wrapper={self:wrapper};opaque(wrapper)'
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  }
  const host = ts.createCompilerHost(options, true)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, createNew) =>
    file === name
      ? ts.createSourceFile(file, content, languageVersion, true, ts.ScriptKind.JS)
      : getSourceFile(file, languageVersion, onError, createNew)
  host.fileExists = (file) => file === name || ts.sys.fileExists(file)
  host.readFile = (file) => (file === name ? content : ts.sys.readFile(file))
  const program = ts.createProgram([name], options, host)
  expect(ts.getPreEmitDiagnostics(program)).toEqual([])
  const source = program.getSourceFile(name)
  const call = source?.statements
    .filter(ts.isExpressionStatement)
    .map((s) => s.expression)
    .find(ts.isCallExpression)
  if (!call?.arguments[0]) throw new Error('Missing real literal-cycle argument')
  expect(someSseArgumentValue(call.arguments[0], program.getTypeChecker(), () => false, true)).toBe(
    true,
  )
})

it('distinguishes actual independent literal receivers from an opaque callback argument', () => {
  const source = matrix.sourceFile('ambientreceiver')
  const checker = matrix.program.getTypeChecker()
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((s) => s.declarationList.declarations)
    .find((d) => ts.isIdentifier(d.name) && d.name.text === 'stream')
  let call: ts.CallExpression | undefined
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'forEach'
    )
      call = node
    node.forEachChild(visit)
  }
  visit(source)
  const frame =
    declaration &&
    ts.isIdentifier(declaration.name) &&
    expressionReceiver(declaration.name, checker)
  if (!frame || !call) throw new Error('Missing actual literal receiver fixture')
  expect(selectedOpaqueSseReceiver(call, checker, [frame], (receiver) => [receiver])).toBe(false)
})

it.each(['ambientrepeated', 'ambientalias', 'ambientarray'] as const)(
  'preserves the published opaque-container boundary in %s',
  (name) => {
    expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame')
    const source = matrix.sourceFile(name)
    const checker = matrix.program.getTypeChecker()
    const declaration = source.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => statement.declarationList.declarations)
      .find((value) => ts.isIdentifier(value.name) && value.name.text === 'stream')
    let call: ts.CallExpression | undefined
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'opaque'
      )
        call = node
      node.forEachChild(visit)
    }
    visit(source)
    const frame =
      declaration &&
      ts.isIdentifier(declaration.name) &&
      expressionReceiver(declaration.name, checker)
    if (!frame || !call) throw new Error('Missing actual independent-container fixture')
    expect(selectedOpaqueSseReceiver(call, checker, [frame], (receiver) => [receiver])).toBe(false)
  },
)
