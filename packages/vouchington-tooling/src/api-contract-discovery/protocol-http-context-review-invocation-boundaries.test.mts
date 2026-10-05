import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

const preamble = `declare const app:any;declare function apiNoContent(key:string):void;
  function factory(options:{assertAccess?:(ctx:any)=>void}){return(ctx:any)=>{
    if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}`
const local = (callback: string) => `${preamble}
  const options={assertAccess:${callback}};
  app.route('/vote').put((ctx:any)=>{apiNoContent('PUT:/vote');factory(options)(ctx)});export {};`
const localControls = {
  responseTag: local('(ctx:any)=>ctx.json`body`'),
  responseTagSubstitution: local('(ctx:any)=>ctx.json`body${1}`'),
  bufferTag: local('(ctx:any)=>ctx.response.buffer`body`'),
  computedResponse: local("(ctx:any)=>{const method='json' as const;ctx[method]({leaked:true})}"),
  computedTag: local("(ctx:any)=>{const method='json' as const;ctx[method]`body`}"),
  deadComputedTag: local(
    "(ctx:any)=>{const method='json' as const;if(false)ctx[method]`body`;ctx.assert(true)}",
  ),
  computedUnknown: local('(ctx:any)=>{declareMethod(ctx)}').replace(
    'const options=',
    'declare const method:string;function declareMethod(ctx:any){ctx[method]({leaked:true})};const options=',
  ),
  independentTag: local(
    '(ctx:any)=>{const tag=(_value:TemplateStringsArray)=>{};tag`body`;ctx.assert(true)}',
  ),
  independentComputed: local(
    "(ctx:any)=>{const method='json' as const;const other={json(_value:unknown){}};other[method]({});ctx.assert(true)}",
  ),
  literalAssert: local("(ctx:any)=>ctx['assert'](true)"),
  deadTag: local('(ctx:any)=>{if(false)ctx.json`body`;ctx.assert(true)}'),
  deadComputed: local(
    "(ctx:any)=>{const method='json' as const;if(false)ctx[method]({});ctx.assert(true)}",
  ),
} as const
const namespaceControls = {
  namespaceWrite: "declare const key:'options'|'other';ns[key].assertAccess=opaque",
  namespaceForward:
    "declare const key:'options'|'other';Object.assign(ns[key],{assertAccess:opaque})",
  namespaceAlias:
    "declare const key:'options'|'other';const namespace=ns;namespace[key].assertAccess=opaque",
  namespaceOpaque: "declare const key:'options'|'other';consume(ns[key])",
  namespaceWrappedOpaque: "declare const key:'options'|'other';consume({value:ns[key]})",
  namespaceRead: "declare const key:'options'|'other';void ns[key].assertAccess",
  independentWrite: "ns['other'].assertAccess=opaque",
  independentForward: "Object.assign(ns['other'],{assertAccess:opaque})",
  independentModule:
    "import * as foreign from './independentModule-unrelated';declare const key:'options'|'other';foreign[key].assertAccess=opaque",
} as const
let root: string
let program: ts.Program
const routes = new Map<string, string>()
beforeAll(() => {
  root = mkdtempSync(join(process.cwd(), 'packages/vouchington-tooling/.http-invocation-review-'))
  const files: string[] = []
  function source(name: string, text: string): string {
    const file = join(root, `${name}.ts`)
    writeFileSync(file, text)
    files.push(file)
    return file
  }
  for (const [name, text] of Object.entries(localControls)) routes.set(name, source(name, text))
  for (const [name, consumer] of Object.entries(namespaceControls)) {
    source(
      `${name}-options`,
      `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};
      export const other={assertAccess:(ctx:any)=>ctx.assert(true)};`,
    )
    source(
      `${name}-consumer`,
      `import * as ns from './${name}-options';
      declare const opaque:(ctx:any)=>void;declare function consume(value:unknown):void;
      ${consumer};export {};`,
    )
    routes.set(
      name,
      source(
        `${name}-route`,
        `import {options} from './${name}-options';
      ${preamble};app.route('/vote').put((ctx:any)=>{
        apiNoContent('PUT:/vote');factory(options)(ctx)});export {};`,
      ),
    )
  }
  source(
    'independentModule-unrelated',
    `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};
    export const other={assertAccess:(ctx:any)=>ctx.assert(true)};`,
  )
  program = ts.createProgram(files, {
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
function contract(name: string) {
  return discoverApiResponseContracts(
    program,
    [program.getSourceFile(routes.get(name)!)!],
    new Set(['PUT:/vote']),
    { onRouteError: () => {} },
  )['PUT:/vote']
}
it.each([
  'responseTag',
  'responseTagSubstitution',
  'bufferTag',
  'computedResponse',
  'computedTag',
  'computedUnknown',
  'namespaceWrite',
  'namespaceForward',
  'namespaceAlias',
  'namespaceOpaque',
  'namespaceWrappedOpaque',
])('rejects selected response/callback provenance in %s', (name) => {
  expect(contract(name)?.statusKnowledge).toBe('unknown')
  expect(contract(name)?.unavailableReason).toBeTruthy()
})
it.each([
  'independentTag',
  'independentComputed',
  'literalAssert',
  'deadTag',
  'deadComputed',
  'deadComputedTag',
  'namespaceRead',
  'independentWrite',
  'independentForward',
  'independentModule',
])('keeps separate or unused provenance in %s', (name) => {
  expect(contract(name)?.unavailableReason).toBeUndefined()
  expect(responseStatusCodesForContract(contract(name)!)).toEqual([204])
})
