import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

const fixture = (setup = '', callback = '(ctx:any)=>ctx.assert(true)', body = '') => `
  declare const app:any
  declare function apiNoContent(key:string):void
  declare function opaque(value:any):void
  declare const flag:boolean
  type Options={assertAccess?:(ctx:any)=>void}
  function identity(ctx:any){return ctx}
  function wrapped(ctx:any){return {ctx}}
  function scalar(_ctx:any){return 1}
  const arrowIdentity=(ctx:any)=>ctx
  function arrayIdentity(ctx:any){return [ctx]}
  function factory(options:Options){return(ctx:any)=>{
    if(options.assertAccess)options.assertAccess(ctx);${body};ctx.setStatus(204)}}
  const options:Options={assertAccess:${callback}}
  ${setup}
  app.route('/vote').put((ctx:any)=>{apiNoContent('PUT:/vote');factory(options)(ctx)})
  export {}
`
const sources = {
  conditional: fixture('opaque(flag?options:{})'),
  conditionalRight: fixture('opaque(flag?{}:options)'),
  logicalOr: fixture('opaque(options||{})'),
  logicalAnd: fixture('opaque(flag&&options)'),
  nullish: fixture('opaque(options??{})'),
  comma: fixture('opaque((void 0,options))'),
  yielded: fixture('function* expose(){yield options};opaque(expose().next().value)'),
  delegatedYield: fixture('function* expose(){yield* [options]};opaque(expose().next().value)'),
  identity: fixture('', '(ctx:any)=>{identity(ctx).json({leaked:true})}'),
  wrappedIdentity: fixture('', '(ctx:any)=>{wrapped(ctx).ctx.json({leaked:true})}'),
  arrowIdentity: fixture('', '(ctx:any)=>{arrowIdentity(ctx).json({leaked:true})}'),
  arrayIdentity: fixture('', '(ctx:any)=>{arrayIdentity(ctx)[0].json({leaked:true})}'),
  forOfDestructure: fixture('', undefined, 'for({method:ctx.setStatus} of [{method:opaque}]){}'),
  forOf: fixture('', undefined, 'for(ctx.setStatus of [opaque]){}'),
  forIn: fixture('', undefined, 'for(ctx.setStatus in {key:true}){}'),
  conditionalIndependent: fixture('opaque(flag?{}:{})'),
  logicalIndependent: fixture('opaque(flag&&{})'),
  commaIndependent: fixture('opaque((void options,{}))'),
  yieldedIndependent: fixture('function* expose(){yield 1};opaque(expose().next().value)'),
  unusedYield: fixture('function* expose(){yield options};void expose'),
  scalar: fixture('', '(ctx:any)=>{scalar(ctx)}'),
  deadConditional: fixture('opaque(false?options:{})'),
  deadYield: fixture(
    'function* expose(){if(false)yield options;yield 1};opaque(expose().next().value)',
  ),
  forOfIndependent: fixture('', undefined, 'let unrelated:any;for(unrelated of [opaque]){}'),
  deadForOf: fixture('', undefined, 'if(false){for(ctx.setStatus of [opaque]){}}'),
} as const
let root: string
let program: ts.Program
let files: Record<keyof typeof sources, string>
beforeAll(() => {
  root = mkdtempSync(join(process.cwd(), 'packages/vouchington-tooling/.http-review-results-'))
  files = Object.fromEntries(
    Object.entries(sources).map(([name, text]) => {
      const file = join(root, `${name}.ts`)
      writeFileSync(file, text)
      return [name, file]
    }),
  ) as Record<keyof typeof sources, string>
  program = ts.createProgram(Object.values(files), {
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([])
})
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})
function contract(name: keyof typeof sources) {
  return discoverApiResponseContracts(
    program,
    [program.getSourceFile(files[name])!],
    new Set(['PUT:/vote']),
    { onRouteError: () => {} },
  )['PUT:/vote']
}
it.each([
  'conditional',
  'conditionalRight',
  'logicalOr',
  'logicalAnd',
  'nullish',
  'comma',
  'yielded',
  'delegatedYield',
  'identity',
  'wrappedIdentity',
  'arrowIdentity',
  'arrayIdentity',
  'forOfDestructure',
  'forOf',
  'forIn',
] as const)('rejects the real capability escape in %s', (name) => {
  expect(contract(name)?.statusKnowledge).toBe('unknown')
  expect(contract(name)?.unavailableReason).toBeTruthy()
})
it.each([
  'conditionalIndependent',
  'logicalIndependent',
  'commaIndependent',
  'yieldedIndependent',
  'unusedYield',
  'scalar',
  'deadConditional',
  'deadYield',
  'forOfIndependent',
  'deadForOf',
] as const)('keeps the independent control in %s', (name) => {
  expect(contract(name)?.unavailableReason).toBeUndefined()
  expect(responseStatusCodesForContract(contract(name)!)).toEqual([204])
})
