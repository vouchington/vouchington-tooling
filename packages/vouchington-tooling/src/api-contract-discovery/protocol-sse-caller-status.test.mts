import { beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { sseCallerScope } from './protocol-sse-callers.mts'
import {
  collectHandlerBindings,
  enclosingRouteBinding,
  visit,
} from './response-contract-route-analysis.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const stream:{write(value:string):void};
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const emitter = `function emit(output:typeof stream){${frame.replace('stream.write', 'output.write')}}`
const route = (body: string) => `${preamble}app.route('/events').get((ctx:any)=>{${body}})`
const sources = {
  helper: `${preamble}${emitter}app.route('/events').get((ctx:any)=>{ctx.setStatus(201);emit(stream)})`,
  alias: `${preamble}${emitter}const send=emit;app.route('/events').get((ctx:any)=>{ctx.setStatus(201);send(stream)})`,
  nested: route(`${emitter}ctx.setStatus(201);emit(stream)`),
  'helper-default': `${preamble}${emitter}app.route('/events').get((ctx:any)=>emit(stream))`,
  'helper-no-context': `${preamble}${emitter}app.route('/events').get(()=>emit(stream))`,
  'helper-destructured-context': `${preamble}${emitter}app.route('/events').get(({query}:any)=>emit(stream))`,
  'helper-dynamic': `${preamble}${emitter}app.route('/events').get((ctx:any)=>{ctx.setStatus(ctx.query.status);emit(stream)})`,
  'helper-conditional': `${preamble}${emitter}app.route('/events').get((ctx:any)=>{if(ctx.query.status)ctx.setStatus(201);emit(stream)})`,
  'helper-context': `${preamble}function emit(context:any,output:typeof stream){context.setStatus(202);${frame.replace('stream.write', 'output.write')}}app.route('/events').get((ctx:any)=>{ctx.setStatus(201);emit(ctx,stream)})`,
  'helper-timer': `${preamble}${emitter}app.route('/events').get((ctx:any)=>{ctx.setStatus(201);setTimeout(()=>emit(stream),1)})`,
  'helper-options': `${preamble}${emitter}function schedule(options:{run:()=>void}){options.run()}app.route('/events').get((ctx:any)=>{ctx.setStatus(201);schedule({run:()=>emit(stream)})})`,
  'helper-promise': `${preamble}app.route('/events').get((ctx:any)=>{ctx.setStatus(201);new Promise<void>(resolve=>{${emitter}emit(stream);resolve()})})`,
  'helper-named-handler': `${preamble}${emitter}const handle=(ctx:any)=>{ctx.setStatus(201);emit(stream)};app.route('/events').get(handle)`,
  'helper-other-route': `${preamble}${emitter}app.route('/events').get((ctx:any)=>{ctx.setStatus(201);emit(stream)});app.route('/other').get((ctx:any)=>{ctx.setStatus(202);emit(stream)})`,
  'helper-factory-options': `${preamble}${emitter}function make(options:{run:(ctx:any)=>void}){return(ctx:any)=>options.run(ctx)}app.route('/events').get(make({run:(ctx:any)=>{ctx.setStatus(201);emit(stream)}}))`,
  'helper-paths': `${preamble}${emitter}app.route('/events').get((ctx:any)=>{if(ctx.query.first){ctx.setStatus(201);emit(stream)}else{emit(stream)}})`,
  'helper-ambiguous': `${preamble}${emitter}app.route('/events').get((ctx:any)=>{ctx.setStatus(201);emit(stream)}).get((ctx:any)=>emit(stream))`,
  'helper-factory': `${preamble}${emitter}function handler(){return(ctx:any)=>{ctx.setStatus(201);emit(stream)}}app.route('/events').get(handler())`,
  'after-frame': route(`${frame};ctx.setStatus(201)`),
  branches: route(
    `if(ctx.query.first){ctx.setStatus(201);${frame}}else{ctx.setStatus(200);${frame}}`,
  ),
  'branch-default': route(`if(ctx.query.first){ctx.setStatus(201);${frame}}else{${frame}}`),
  conditional: route(`if(ctx.query.first)ctx.setStatus(201);${frame}`),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const discover = (name: keyof typeof sources, lenient = false) =>
  discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
it.each(['helper', 'nested'] as const)('uses the bound caller status in %s', (name) => {
  expect(Object.values(discover(name)).map(responseStatusCodesForContract)).toEqual([[201]])
})
it('rejects inherited route attribution without a registered caller context', () => {
  const file = matrix.sourceFile('helper-factory-options')
  const checker = matrix.program.getTypeChecker()
  const calls: ts.CallExpression[] = []
  visit(file, (node) => {
    if (ts.isCallExpression(node)) calls.push(node)
  })
  const helper = file.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'emit',
  ) as ts.FunctionDeclaration
  const invocation = calls.find(
    (node) => ts.isIdentifier(node.expression) && node.expression.text === 'emit',
  )!
  const bindings = collectHandlerBindings([file], checker)
  const binding = enclosingRouteBinding(invocation, checker, bindings, false)!
  expect(binding).toEqual({ method: 'GET', routeTemplate: '/events' })
  expect(() => sseCallerScope([helper], calls, binding, bindings, checker)).toThrow(
    'registered caller context',
  )
})
it.each(['helper-other-route', 'helper-named-handler'] as const)(
  'selects the matching registered helper caller in %s',
  (name) => {
    const file = matrix.sourceFile(name)
    const checker = matrix.program.getTypeChecker()
    const calls: ts.CallExpression[] = []
    visit(file, (node) => {
      if (ts.isCallExpression(node)) calls.push(node)
    })
    const helper = file.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'emit',
    ) as ts.FunctionDeclaration
    const invocation = calls.find(
      (node) => ts.isIdentifier(node.expression) && node.expression.text === 'emit',
    )!
    const bindings = collectHandlerBindings([file], checker)
    const binding = enclosingRouteBinding(invocation, checker, bindings, false)!
    expect(sseCallerScope([helper], calls, binding, bindings, checker)?.paths).toHaveLength(1)
  },
)
it.each([
  'alias',
  'helper-destructured-context',
  'helper-factory',
  'helper-factory-options',
  'helper-named-handler',
] as const)('rejects unresolved route bindings in %s', (name) => {
  expect(() => discover(name)).toThrow('must be inside an app.route handler')
})
it('keeps a helper default when its caller sets no status', () => {
  expect(Object.values(discover('helper-default')).map(responseStatusCodesForContract)).toEqual([
    [200],
  ])
})
it.each([
  ['helper-context', [[202]]],
  ['helper-timer', [[201]]],
  ['helper-options', [[201]]],
  ['helper-promise', [[201]]],
  ['helper-paths', [[200, 201]]],
  ['after-frame', [[200]]],
  ['helper-no-context', [[200]]],
] as const)('resolves executable status paths in %s', (name, statuses) => {
  expect(Object.values(discover(name)).map(responseStatusCodesForContract)).toEqual(statuses)
})
it.each(['branches', 'branch-default'] as const)('keeps mutually exclusive %s', (name) => {
  expect(Object.values(discover(name)).map(responseStatusCodesForContract)).toEqual([[201], [200]])
})
it.each(['helper-dynamic', 'helper-conditional', 'conditional', 'helper-ambiguous'] as const)(
  'fails closed for %s',
  (name) => {
    expect(() => discover(name)).toThrow()
    expect(Object.values(discover(name, true)).every((row) => row.unavailableReason)).toBe(true)
  },
)
