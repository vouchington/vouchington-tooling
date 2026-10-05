import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { nodePassThroughUnmodified } from './protocol-sse-node-constructor.mts'
import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'

const preamble = `import {PassThrough} from 'node:stream';
  import {createRequire,syncBuiltinESMExports} from 'node:module';
  declare const app:any;const prior=new PassThrough();
  class Replacement extends PassThrough{constructor(){super();return prior}}
  declare function opaque(value:unknown):void;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  `
const route = `app.route('/events').get(()=>{opaque(prior);const stream=new PassThrough();
  stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const cases = {
  'synced-export-replacement': [
    `${preamble}createRequire(import.meta.url)('node:stream').PassThrough=Replacement;
    syncBuiltinESMExports();${route}`,
    false,
  ],
  'normal-pass-through': [`${preamble}${route}`, true],
  'unsynced-export-control': [
    `${preamble}createRequire(import.meta.url)('node:stream').PassThrough=Replacement;${route}`,
    true,
  ],
  'synced-export-metadata': [
    `${preamble}createRequire(import.meta.url)('node:stream').metadata='stable';
    syncBuiltinESMExports();${route}`,
    true,
  ],
  'synced-constructor-metadata': [
    `${preamble}createRequire(import.meta.url)('node:stream').PassThrough.label='stable';
    syncBuiltinESMExports();${route}`,
    true,
  ],
  'synced-alias-export-replacement': [
    `${preamble}const requireNode=createRequire(import.meta.url);
    const exports=requireNode('stream');exports['PassThrough']=Replacement;
    syncBuiltinESMExports();${route}`,
    false,
  ],
  'synced-dynamic-export-replacement': [
    `${preamble}declare const key:string;
    createRequire(import.meta.url)('node:stream')[key]=Replacement;
    syncBuiltinESMExports();${route}`,
    false,
  ],
  'synced-dynamic-module-replacement': [
    `${preamble}declare const moduleName:string;
    createRequire(import.meta.url)(moduleName).PassThrough=Replacement;
    syncBuiltinESMExports();${route}`,
    false,
  ],
  'synced-other-module-control': [
    `${preamble}createRequire(import.meta.url)('node:fs').PassThrough=Replacement;
    syncBuiltinESMExports();${route}`,
    true,
  ],
  'synced-global-property-control': [
    `${preamble}(globalThis as any).PassThrough=Replacement;
    syncBuiltinESMExports();${route}`,
    true,
  ],
  'cyclic-javascript-aliases-control': [`${preamble}${route}`, true],
} as const
let root: string
let programs: Record<keyof typeof cases, ts.Program>
let files: Record<keyof typeof cases, string>
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sse-node-constructor-'))
  const directory = dirname(fileURLToPath(import.meta.url))
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    // Unchecked Node JavaScript is an admitted compiler input; its alias cycles must terminate.
    allowJs: true,
    checkJs: false,
    typeRoots: [join(directory, '../../../../node_modules/@types')],
    types: ['node'],
  }
  files = Object.fromEntries(
    Object.entries(cases).map(([name, [source]]) => {
      const file = join(root, `${name}.mts`)
      writeFileSync(file, source)
      return [name, file]
    }),
  ) as Record<keyof typeof cases, string>
  programs = Object.fromEntries(
    Object.entries(files).map(([name, file]) => {
      const roots = [file]
      if (name === 'cyclic-javascript-aliases-control') {
        const javascript = join(root, 'cyclic-aliases.mjs')
        writeFileSync(
          javascript,
          `import {syncBuiltinESMExports} from 'node:module';
          const first=second;const second=first;first.PassThrough=class {};
          const requireFirst=requireSecond;const requireSecond=requireFirst;
          requireFirst('node:stream').PassThrough=class {};syncBuiltinESMExports();`,
        )
        roots.push(javascript)
      }
      const program = ts.createProgram(roots, options)
      expect(
        ts
          .getPreEmitDiagnostics(program)
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
      ).toEqual([])
      return [name, program]
    }),
  ) as Record<keyof typeof cases, ts.Program>
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
afterAll(() => rmSync(root, { recursive: true, force: true }))
it.each(Object.keys(cases) as (keyof typeof cases)[])(
  'checks actual Node constructor export provenance in %s',
  (name) => {
    const program = programs[name]
    expect(
      nodePassThroughUnmodified(program.getSourceFile(files[name])!, program.getTypeChecker()),
    ).toBe(cases[name][1])
    const discover = () =>
      discoverApiResponseContracts(program, [program.getSourceFile(files[name])!])
    if (cases[name][1]) expect(discover()['GET:/events']?.unavailableReason).toBeUndefined()
    else expect(discover).toThrow('unmarked frame')
  },
)
