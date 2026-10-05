import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { factoryCreatesFreshSelectedStream } from './protocol-sse-fresh-factory.mts'

let fixtureRoot: string
let program: ts.Program
let consumer: ts.SourceFile

function callNamed(name: string): ts.CallExpression {
  const declaration = consumer.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((item) => ts.isIdentifier(item.name) && item.name.text === name)
  if (!declaration?.initializer || !ts.isCallExpression(declaration.initializer))
    throw new Error(`Missing factory call ${name}`)
  return declaration.initializer
}

describe('SSE fresh factory proof follows real imported bindings', () => {
  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.sse-factory-proof-'))
    const files = {
      node: join(fixtureRoot, 'node-factory.ts'),
      legacy: join(fixtureRoot, 'legacy-factory.ts'),
      consumer: join(fixtureRoot, 'consumer.ts'),
    }
    writeFileSync(
      files.node,
      `import {PassThrough} from 'node:stream';
       export function createNode(){const stream=new PassThrough();return {stream}}`,
    )
    writeFileSync(
      files.legacy,
      `import {PassThrough} from 'stream';
       export function createLegacy(){const stream=new PassThrough();return {stream}}`,
    )
    writeFileSync(
      files.consumer,
      `import {createNode as importedNode} from './node-factory.js';
       import {createLegacy as importedLegacy} from './legacy-factory.js';
       const nodeResult=importedNode();const legacyResult=importedLegacy();`,
    )
    const options: ts.CompilerOptions = {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
      typeRoots: [join(dirname(fileURLToPath(import.meta.url)), '../../../../node_modules/@types')],
      types: ['node'],
    }
    program = ts.createProgram(Object.values(files), options)
    expect(ts.getPreEmitDiagnostics(program)).toEqual([])
    const source = program.getSourceFile(files.consumer)
    if (!source) throw new Error('Missing consumer source')
    consumer = source
  })

  afterAll(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it.each(['nodeResult', 'legacyResult'])('accepts fresh stream from %s', (name) => {
    const call = callNamed(name)
    const checker = program.getTypeChecker()
    expect(checker.getSymbolAtLocation(call.expression)!.flags & ts.SymbolFlags.Alias).toBeTruthy()
    expect(factoryCreatesFreshSelectedStream(call, 'stream', checker)).toBe(true)
  })
})
