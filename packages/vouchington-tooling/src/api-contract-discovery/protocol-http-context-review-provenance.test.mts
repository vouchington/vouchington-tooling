import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createContextPrototypeProof } from './protocol-http-context-prototype.mts'
import { createContextRequiredModule } from './protocol-http-context-require.mts'
import { taintContextConstruction } from './protocol-http-implicit-taint.mts'
import { collectHandlerBindings } from './response-contract-route-analysis.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function checkedProgram<T>(
  files: Record<string, string>,
  inspect: (program: ts.Program, directory: string) => T,
): T {
  const directory = mkdtempSync(join(tmpdir(), 'http-provenance-'))
  try {
    const names = Object.entries(files).map(([name, content]) => {
      const file = join(directory, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
      return file
    })
    const program = ts.createProgram(names, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      noEmit: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      typeRoots: [join(dirname(fileURLToPath(import.meta.url)), '../../../../node_modules/@types')],
      types: ['node'],
    })
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    ).toEqual([])
    return inspect(program, directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function contract(files: Record<string, string>, route = 'route.cts') {
  return checkedProgram(files, (program, directory) => {
    const source = program.getSourceFile(join(directory, route))
    if (!source) throw new Error(`Missing route source ${route}`)
    return discoverApiResponseContracts(program, [source], new Set(['PUT:/vote']))['PUT:/vote']
  })
}

function expectUnknown(files: Record<string, string>): void {
  const row = contract(files)
  expect(row?.statusKnowledge).toBe('unknown')
  expect(row?.unavailableReason).toBeTruthy()
}

function expectNoContent(files: Record<string, string>): void {
  const row = contract(files)
  expect(row?.unavailableReason).toBeUndefined()
  expect(responseStatusCodesForContract(row!)).toEqual([204])
}

const route = (setup: string, body = 'factory(options)(ctx)') => `declare const app:any;
  declare function apiNoContent(key:string):void;
  declare function opaque(value:any):void;
  type Options={assertAccess?:(ctx:any)=>void};
  function factory(options:Options){return(ctx:any)=>{
    if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}
  ${setup}
  app.route('/vote').put((ctx:any)=>{
    apiNoContent('PUT:/vote');${body}});export {};`

const importedRoute = `import {options} from './options.cjs';
  ${route('')}`

describe('HTTP context proof follows real module and constructor provenance', () => {
  it('rejects a write through a standard unshadowed Node require', () => {
    expectUnknown({
      'options.cts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
      'consumer.cts': `const mod=require('./options.cjs');
        declare const opaque:(ctx:any)=>void;mod.options.assertAccess=opaque;export {};`,
      'route.cts': importedRoute,
    })
  })

  it('keeps an imported callback after a read-only standard require', () => {
    expectNoContent({
      'options.cts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
      'consumer.cts': `const mod=require('./options.cjs');void mod.options;export {};`,
      'route.cts': importedRoute,
    })
  })

  it('rejects Object.prototype returned through a concrete helper and escaped', () => {
    expectUnknown({
      'route.cts': route(`function expose(){return Object.prototype}
        opaque(expose());const options:Options={};`),
    })
  })

  it('keeps an absent callback after a harmless local value escapes', () => {
    expectNoContent({
      'route.cts': route(`function expose(){return {tag:'safe'}}
        opaque(expose());const options:Options={};`),
    })
  })

  it('keeps prototype proof when an opaque call receives a bodyless declared result', () => {
    checkedProgram(
      {
        'route.cts': `declare function external():object;
          declare function opaque(value:any):void;opaque(external());export {};`,
      },
      (program) => {
        const safe = createContextPrototypeProof(program.getTypeChecker(), program.getSourceFiles())
        expect(safe()).toBe(true)
      },
    )
  })

  it('rejects an opaque escape through mutually recursive returned helpers', () => {
    expectUnknown({
      'route.cts': route(`function first():object{return second()}
        function second():object{return first()}
        opaque(first());const options:Options={};`),
    })
  })

  it('rejects a prototype mutation through a string bracket key', () => {
    expectUnknown({
      'route.cts': route(`({} as any)['__proto__'].assertAccess=opaque;
        const options:Options={};`),
    })
  })

  it('does not assign Node require provenance to a local shadowing function', () => {
    checkedProgram(
      {
        'options.cts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
        'consumer.cts': `const require=(name:string)=>({name});
          const selected=require('./options.cjs');export {selected};`,
      },
      (program, directory) => {
        const source = program.getSourceFile(join(directory, 'consumer.cts'))
        if (!source) throw new Error('Missing shadowed require consumer')
        let call: ts.CallExpression | undefined
        function visit(node: ts.Node): void {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'
          )
            call = node
          ts.forEachChild(node, visit)
        }
        visit(source)
        if (!call) throw new Error('Missing shadowed require call')
        const required = createContextRequiredModule(
          program.getTypeChecker(),
          program.getSourceFiles(),
          program.getCompilerOptions(),
        )
        expect(required(call)).toBeUndefined()
      },
    )
  })

  it('resolves a required package through an admitted package JSON source', () => {
    checkedProgram(
      {
        'node_modules/fixture/package.json': `{"name":"fixture","exports":{".":"./options.cjs"}}`,
        'node_modules/fixture/options.cts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
        'consumer.cts': `const selected=require('fixture');export {selected};`,
      },
      (program, directory) => {
        const source = program.getSourceFile(join(directory, 'consumer.cts'))
        const manifest = program.getSourceFile(join(directory, 'node_modules/fixture/package.json'))
        if (!source || !manifest) throw new Error('Missing package resolution fixture')
        let call: ts.CallExpression | undefined
        function visit(node: ts.Node): void {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'
          )
            call = node
          ts.forEachChild(node, visit)
        }
        visit(source)
        if (!call) throw new Error('Missing package require call')
        const required = createContextRequiredModule(
          program.getTypeChecker(),
          program.getSourceFiles(),
          program.getCompilerOptions(),
        )
        expect(required(call)?.name).toContain('options')
      },
    )
  })

  it('does not taint a route omitted from the selected discovery source list', () => {
    checkedProgram(
      {
        'route.cts': `declare const app:any;
          declare class Sink{constructor(value:any)}
          function helper(ctx:any){new Sink(ctx)}
          app.route('/vote').put((ctx:any)=>{helper(ctx);ctx.setStatus(204)});export {};`,
      },
      (program, directory) => {
        const source = program.getSourceFile(join(directory, 'route.cts'))
        if (!source) throw new Error('Missing omitted route fixture')
        let construction: ts.NewExpression | undefined
        function visit(node: ts.Node): void {
          if (ts.isNewExpression(node)) construction = node
          ts.forEachChild(node, visit)
        }
        visit(source)
        if (!construction) throw new Error('Missing construction')
        const checker = program.getTypeChecker()
        const handlers = collectHandlerBindings([], checker)
        const contracts = new Map()
        taintContextConstruction(construction, checker, contracts, handlers)
        expect(contracts.size).toBe(0)
      },
    )
  })

  it('rejects a context spread into an opaque constructor', () => {
    expectUnknown({
      'route.cts': route(
        `declare class Sink{constructor(...values:any[])}`,
        `new Sink(...[ctx]);ctx.setStatus(204)`,
      ),
    })
  })

  it('keeps status 204 when a constructor receives only a spread primitive', () => {
    expectNoContent({
      'route.cts': route(
        `declare class Sink{constructor(...values:any[])}`,
        `new Sink(...[42]);ctx.setStatus(204)`,
      ),
    })
  })
})
