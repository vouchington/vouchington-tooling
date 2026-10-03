import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import {
  platformCallbackArgument,
  registerPlatformCompilerLibraries,
} from './protocol-platform-callbacks.mts'
import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'

let root: string
let program: ts.Program
let calls: Record<string, ts.NewExpression>
let foreignFile: ts.SourceFile

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'protocol-compiler-context-'))
  const ownLibrary = dirname(ts.getDefaultLibFilePath({}))
  const alternateLibrary = join(root, 'alternate-compiler-lib')
  cpSync(ownLibrary, alternateLibrary, { recursive: true })
  const foreignPath = join(ownLibrary, 'lib.foreign-platform.d.ts')
  foreignFile = ts.createSourceFile(
    foreignPath,
    'export declare const Promise: PromiseConstructor;',
    ts.ScriptTarget.ESNext,
    true,
  )
  const file = join(root, 'routes.ts')
  writeFileSync(
    file,
    `import {Promise as ForeignPromise} from 'foreign-platform';
    const actual=new Promise<void>(resolve=>resolve());
    const foreign=new ForeignPromise<void>(resolve=>resolve());
    function ignored(){class Promise<T>{constructor(callback:(resolve:(value?:T)=>void)=>void){}}
      const shadowed=new Promise<void>(resolve=>resolve());}`,
  )
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  }
  const host = ts.createCompilerHost(options, true)
  host.getDefaultLibLocation = () => alternateLibrary
  host.getDefaultLibFileName = (options) =>
    join(alternateLibrary, basename(ts.getDefaultLibFilePath(options)))
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, version, onError, fresh) =>
    file === foreignPath ? foreignFile : original(file, version, onError, fresh)
  host.resolveModuleNames = (names, containingFile) =>
    names.map((name) =>
      name === 'foreign-platform'
        ? { resolvedFileName: foreignPath, extension: ts.Extension.Dts }
        : ts.resolveModuleName(name, containingFile, options, host).resolvedModule,
    )
  program = ts.createProgram([file], options, host)
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
  ).toEqual([])
  calls = {}
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isNewExpression(node.initializer)
    )
      calls[node.name.text] = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(program.getSourceFile(file)!)
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

it('recognizes the actual program library across compiler installations without trusting foreign declarations', () => {
  const checker = program.getTypeChecker()
  expect(platformCallbackArgument(calls['actual']!, checker)).toBeUndefined()
  expect(program.isSourceFileDefaultLibrary(foreignFile)).toBe(false)
  registerPlatformCompilerLibraries(program)
  expect(
    platformCallbackArgument(calls['actual']!, checker) === calls['actual']!.arguments?.[0],
  ).toBe(true)
  expect(platformCallbackArgument(calls['shadowed']!, checker)).toBeUndefined()
  expect(platformCallbackArgument(calls['foreign']!, checker)).toBeUndefined()
})
