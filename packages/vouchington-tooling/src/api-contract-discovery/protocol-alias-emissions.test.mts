import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from '../contract-schema/typescript-api.mts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any
  declare const stream:{write(value:string):void}
  declare const other:{write(value:string):void}
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string
  type Http<T>=Response&{readonly apiHttpResponseVariants?:T}
  declare function apiOpenApiHttpResponse<K extends string,T>(key:K,response:Http<T>):Http<T>
  declare const opaque:Http<{status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}|{status:202;bodyKind:'none'}>
  declare const unknownBody:unknown;`
const http = (body: string) => `${preamble} app.route('/rpc').post(async(ctx:any)=>{
  const response=apiOpenApiHttpResponse('POST:/rpc',opaque); ${body} })`
const emit = `ctx.setStatus(response.status);if(!response.body)ctx.response.empty();else ctx.pipeline(response.body)`
const sse = (body: string) => `${preamble} app.route('/events').get((ctx:any)=>{${body}})`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const sources = {
  'context-alias': http(`const sender=ctx;const target=sender.response;
    sender.setStatus(response.status);if(!response.body)target.empty();else sender.pipeline(response.body)`),
  'response-alias': http(`const target=ctx.response;ctx.setStatus(response.status);
    if(!response.body)target.empty();else target.buffer(await response.arrayBuffer())`),
  'raw-context-alias': http(`${emit}; const sender=ctx;sender.json(unknownBody)`),
  'raw-response-alias': http(`${emit}; const target=ctx.response;target.buffer(unknownBody)`),
  'mutable-context': http(`${emit};let sender=ctx;sender={};sender.json(unknownBody)`),
  'mutable-response': http(`${emit};let target=ctx.response;target={};target.buffer(unknownBody)`),
  'destructured-context': http(`${emit};const {response:target}=ctx;target.buffer(unknownBody)`),
  'request-read': http(
    `${emit};let input=ctx.req;input={};(ctx as Context).set('X',String(input))`,
  ),
  'stream-alias': sse(`${frame};const output=stream;output.write('raw')`),
  'mutable-stream-alias': sse(`${frame};let output=stream;output.write('raw')`),
  'mutable-stream-frame': sse(
    `let output=stream;output.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`,
  ),
  'receiver-cycle':
    sse(`// @ts-expect-error Intentionally invalid runtime alias cycle must fail closed.
    const cycle:typeof stream=cycle;cycle.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`),
  'property-alias':
    sse(`const source={stream};source.stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));
    const output=source.stream;output.write('raw')`),
  'different-stream': sse(`${frame};const output=other;output.write('log')`),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
let fixtureRoot: string
afterAll(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
})
const discover = (name: keyof typeof sources, lenient = false) =>
  discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )

describe('protocol emission aliases', () => {
  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'protocol-platform-provenance-'))
    const dependency = join(fixtureRoot, 'node_modules/@jongleberry/api-server')
    mkdirSync(dependency, { recursive: true })
    writeFileSync(
      join(dependency, 'package.json'),
      JSON.stringify({
        name: '@jongleberry/api-server',
        version: '0.0.0',
        type: 'module',
        types: './index.d.mts',
      }),
    )
    writeFileSync(
      join(dependency, 'index.d.mts'),
      'export declare class Context {set(header:string,value:string):void}',
    )
    const files = new Map(
      Object.entries(sources).map(([name, source]) => {
        const file = join(fixtureRoot, `${name}.ts`)
        writeFileSync(
          file,
          `import type {Context} from '@jongleberry/api-server';
${source}
export {}`,
        )
        return [name, file]
      }),
    )
    const program = ts.createProgram([...files.values()], {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ESNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    })
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((value) => ts.flattenDiagnosticMessageText(value.messageText, '\n')),
    ).toEqual([])
    matrix = {
      program,
      sourceFile(name) {
        return program.getSourceFile(files.get(name)!)!
      },
    }
  })
  it.each(['context-alias', 'response-alias', 'request-read', 'different-stream'] as const)(
    'preserves the actual emissions in %s',
    (name) => {
      const contracts = Object.values(discover(name))
      expect(contracts.length).toBeGreaterThan(0)
      expect(contracts.every((contract) => !contract.unavailableReason)).toBe(true)
    },
  )
  it.each([
    'raw-context-alias',
    'raw-response-alias',
    'mutable-context',
    'mutable-response',
    'destructured-context',
    'stream-alias',
    'mutable-stream-alias',
    'mutable-stream-frame',
    'receiver-cycle',
    'property-alias',
  ] as const)('fails closed for extra or mutable emissions in %s', (name) => {
    expect(() => discover(name)).toThrow()
    expect(Object.values(discover(name, true)).some((contract) => contract.unavailableReason)).toBe(
      true,
    )
  })
})

it.each([
  ['node:stream', 'Readable', true],
  ['stream', 'Readable', false],
  ['node:stream', 'PassThrough as Readable', false],
] as const)('checks the actual %s import of %s', (moduleName, imported, supported) => {
  const root = mkdtempSync(join(tmpdir(), 'protocol-readable-'))
  try {
    const file = join(root, 'route.ts')
    writeFileSync(
      file,
      `import {${imported}} from '${moduleName}';` +
        http(`ctx.setStatus(response.status);
        if(!response.body)ctx.response.empty();else ctx.pipeline(Readable.from(response.body as AsyncIterable<Uint8Array>))`),
    )
    const program = ts.createProgram([file], {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      typeRoots: [join(process.cwd(), 'node_modules/@types')],
      types: ['node'],
    })
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((value) => ts.flattenDiagnosticMessageText(value.messageText, '\n')),
    ).toEqual([])
    const discoverReadable = () =>
      discoverApiResponseContracts(program, [program.getSourceFile(file)!])
    if (supported)
      expect(Object.values(discoverReadable()).map((value) => value.statusCodes)).toEqual([
        [200],
        [202],
      ])
    else expect(discoverReadable).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
