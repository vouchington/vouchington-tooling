import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { factoryPipeline } from './protocol-sse-pipeline-origin.mts'
import { expressionReceiver, writeReceiver } from './protocol-write-receiver.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  declare const choose:boolean;
  class Stream{write(_value:string){return true}}
  type SSEContext={stream:Stream};`
const frame = `apiSseFrame('GET:/events',{event:'done' as const,data:{ok:true}})`
const helper = (returned: string, before = '') =>
  `function start(ctx:any):SSEContext{
    const stream=new Stream();ctx.pipeline(stream);${before}return ${returned}}`
const route = (body: string) => `app.route('/events').get((ctx:any)=>{${body}})`
const fixture = (start: string, body: string) => `${preamble}${start}${route(body)}`
const write = (receiver: string) => `${receiver}.write(${frame})`
const sources = {
  shorthand: fixture(helper('{stream}'), `const holder=start(ctx);${write('holder.stream')}`),
  destructured: fixture(helper('{stream}'), `const {stream:output}=start(ctx);${write('output')}`),
  'destructured-shorthand': fixture(
    helper('{stream}'),
    `const {stream}=start(ctx);${write('stream')}`,
  ),
  'single-assignment': fixture(
    helper('{stream}'),
    `let unrelated=0;unrelated=1;let holder:SSEContext;holder=start(ctx);${write('holder.stream')}`,
  ),
  'mutable-alias': fixture(
    helper('{stream}'),
    `const holder=start(ctx);let alias=holder;${write('alias.stream')}`,
  ),
  'array-binding': fixture(
    helper('{stream}'),
    `const [output]=start(ctx) as unknown as [Stream];${write('output')}`,
  ),
  'rest-binding': fixture(helper('{stream}'), `const {...rest}=start(ctx);${write('rest.stream')}`),
  'numeric-binding-key': fixture(
    helper('{stream}'),
    `const {0:output}=start(ctx) as unknown as {0:Stream};${write('output')}`,
  ),
  'parameter-root': fixture(
    `${helper('{stream}')}function emit(output:Stream){${write('output')}}`,
    `const holder=start(ctx);emit(holder.stream)`,
  ),
  'source-owner': `${preamble}${helper('{stream}')}
    let holder:SSEContext;${route(`holder=start(ctx);${write('holder.stream')}`)}`,
  'different-invocation': fixture(
    `${helper('{stream}')}
     function other(_ctx:any):SSEContext{const stream=new Stream();return {stream}}`,
    `const holder=other(ctx);start(ctx);${write('holder.stream')}`,
  ),
  'unary-write': fixture(
    helper('{stream}'),
    `let holder:any;holder++;start(ctx);${write('holder.stream')}`,
  ),
  'multiple-assignments': fixture(
    helper('{stream}'),
    `let holder:SSEContext;holder=start(ctx);holder=start(ctx);${write('holder.stream')}`,
  ),
  'bare-return': fixture(
    `function start(ctx:any):SSEContext|undefined{
      const stream=new Stream();ctx.pipeline(stream);if(ctx.abort)return;return {stream}}`,
    `const holder=start(ctx)!;${write('holder.stream')}`,
  ),
  'returned-alias': fixture(
    helper('holder', 'const holder={stream};'),
    `const holder=start(ctx);${write('holder.stream')}`,
  ),
  'spread-return': fixture(
    helper('{...{stream}}'),
    `const holder=start(ctx);${write('holder.stream')}`,
  ),
  'computed-return-key': fixture(
    helper("{[choose?'stream':'other']:stream} as unknown as SSEContext"),
    `const holder=start(ctx);${write('holder.stream')}`,
  ),
  'missing-property': fixture(
    helper('{other:stream} as unknown as SSEContext'),
    `const holder=start(ctx);${write('holder.stream')}`,
  ),
  'explicit-property': fixture(
    helper('{stream:stream}'),
    `const holder=start(ctx);${write('holder.stream')}`,
  ),
  'method-property': fixture(
    helper('{stream(){return stream}} as unknown as SSEContext'),
    `const holder=start(ctx);${write('holder.stream')}`,
  ),
} as const
type SourceName = keyof typeof sources
let matrix: VirtualProgramMatrix<SourceName>

function actualProof(name: SourceName) {
  const source = matrix.sourceFile(name)
  const checker = matrix.program.getTypeChecker()
  const fn = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'start',
  )
  let pipeline: ts.CallExpression | undefined
  let frameWrite: ts.CallExpression | undefined
  const invocations: ts.CallExpression[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === 'pipeline') pipeline = node
      if (node.expression.name.text === 'write') frameWrite = node
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'start'
    )
      invocations.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!fn || !pipeline || !frameWrite || !invocations[0])
    throw new Error(`Missing concrete origin nodes in ${name}`)
  const frameReceiver = writeReceiver(frameWrite, checker)
  const argument = pipeline.arguments[0]
  const streamReceiver = argument && expressionReceiver(argument, checker)
  if (!frameReceiver || !streamReceiver) throw new Error(`Missing real receivers in ${name}`)
  return factoryPipeline(frameReceiver, invocations[0], fn, streamReceiver, checker)
}

describe('SSE pipeline origin proof uses actual compiler bindings', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
    for (const name of Object.keys(sources) as SourceName[]) matrix.sourceFile(name)
  })

  it.each([
    'shorthand',
    'destructured',
    'destructured-shorthand',
    'single-assignment',
    'explicit-property',
  ] as const)('proves a selected stream returned by %s', (name) =>
    expect(actualProof(name)).toBe(true),
  )

  it.each([
    'mutable-alias',
    'array-binding',
    'rest-binding',
    'numeric-binding-key',
    'parameter-root',
    'source-owner',
    'different-invocation',
    'unary-write',
    'multiple-assignments',
    'bare-return',
    'returned-alias',
    'spread-return',
    'computed-return-key',
    'missing-property',
    'method-property',
  ] as const)('rejects an unproven %s stream origin', (name) => {
    expect(actualProof(name)).toBe(false)
  })
})
