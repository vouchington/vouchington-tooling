import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import {
  mutationAffectsSelectedStream,
  sseWriteMutations,
} from './protocol-sse-write-mutations.mts'
import { expressionReceiver, writeReceiver } from './protocol-write-receiver.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const route = (body: string) => `declare const app:any;
 declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
 class Stream { write(_value:string):void{};end(_value?:unknown):void{} }
 class Other { write(_value:string):void{};end(_value?:unknown):void{} }
 const stream=new Stream();const other=new Other();const sibling=new Stream();
 const replacement=(_value?:unknown)=>{};
 app.route('/events').get(()=>{${body};stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const withReceiver = (declaration: string, receiver: string, body: string) =>
  route(body)
    .replace('const stream=new Stream();', declaration)
    .replace('stream.write(apiSseFrame', `${receiver}.write(apiSseFrame`)
const sources = {
  nested: withReceiver(
    'declare const stream:{inner:Stream};',
    'stream.inner',
    'Stream.prototype.write=replacement',
  ),
  missing: withReceiver(
    'const stream={} as any;',
    'stream.inner',
    'Stream.prototype.write=replacement',
  ),
  union: withReceiver(
    'declare const stream:Other|Stream;',
    'stream',
    'Stream.prototype.write=replacement',
  ),
  structural: withReceiver(
    'declare const stream:{write(value:string):void;end(value?:unknown):void};',
    'stream',
    'Stream.prototype.write=replacement',
  ),
  ownfield: withReceiver(
    'class Own extends Stream {override write=(_value:string)=>{}};const stream=new Own();',
    'stream',
    'Stream.prototype.write=replacement',
  ),
  constructor: route('Stream.prototype.write=replacement'),
  instance: route('(stream as Stream & {__proto__:Stream}).__proto__.write=replacement'),
  inheritedconstructor: route('stream.constructor.prototype.write=replacement'),
  constructoralias: route('const Constructor=Stream;Constructor.prototype.write=replacement'),
  prototypealias: route('const prototype=Stream.prototype;prototype.write=replacement'),
  sibling: route('(sibling as Stream & {__proto__:Stream}).__proto__.write=replacement'),
  siblingconstructor: route('sibling.constructor.prototype.write=replacement'),
  end: route('Stream.prototype.end=replacement'),
  independent: route('Other.prototype.write=replacement'),
  independentinstance: route('(other as Other & {__proto__:Other}).__proto__.write=replacement'),
  independentconstructor: route('other.constructor.prototype.write=replacement'),
  dead: route('if(false){Stream.prototype.write=replacement}'),
  uncalled: route('function unused(){Stream.prototype.write=replacement}'),
  helper: route('function replace(){Stream.prototype.write=replacement};replace()'),
  ignored: route(
    'function ignore(_callback:()=>void){};ignore(()=>{Stream.prototype.write=replacement})',
  ),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
  expect(ts.getPreEmitDiagnostics(matrix.program)).toEqual([])
})
const row = (name: keyof typeof sources) =>
  discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)], undefined, {
    onRouteError: () => {},
  })['GET:/events']

it.each([
  'union',
  'structural',
  'constructor',
  'instance',
  'inheritedconstructor',
  'constructoralias',
  'prototypealias',
  'sibling',
  'siblingconstructor',
  'end',
  'helper',
] as const)('rejects selected prototype mutation: %s', (name) =>
  expect(row(name)?.unavailableReason).toBe('SSE route writes an unmarked frame'),
)
it.each([
  'ownfield',
  'independent',
  'independentinstance',
  'independentconstructor',
  'dead',
  'uncalled',
  'ignored',
] as const)('preserves independent or unexecuted prototype mutation: %s', (name) =>
  expect(row(name)?.unavailableReason).toBeUndefined(),
)

it.each(['nested', 'missing'] as const)('matches actual nested receiver prototype: %s', (name) => {
  const checker = matrix.program.getTypeChecker()
  const mutations: ReturnType<typeof sseWriteMutations> = []
  const frames: NonNullable<ReturnType<typeof writeReceiver>>[] = []
  const visit = (node: ts.Node) => {
    mutations.push(...sseWriteMutations(node))
    if (ts.isCallExpression(node)) {
      const receiver = writeReceiver(node, checker)
      if (receiver) frames.push(receiver)
    }
    ts.forEachChild(node, visit)
  }
  visit(matrix.sourceFile(name))
  expect(frames).toHaveLength(1)
  expect(
    mutationAffectsSelectedStream(
      mutations,
      frames,
      checker,
      () => true,
      () => false,
      (expression) => [expressionReceiver(expression, checker)],
      (receiver) => [receiver],
    ),
  ).toBe(true)
})
