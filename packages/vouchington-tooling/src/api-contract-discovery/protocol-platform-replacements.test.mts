import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import {
  platformCallbackArgument,
  registerPlatformCompilerLibraries,
} from './protocol-platform-callbacks.mts'
import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'

const replacement = `(()=>0) as unknown as typeof setTimeout`
const cases = {
  direct: [`globalThis.setTimeout=${replacement};const result=setTimeout(cb,1)`, false],
  bracket: [`globalThis['setTimeout']=${replacement};const result=setTimeout(cb,1)`, false],
  computed: [
    `const key:string='setTimeout';(globalThis as Record<string,unknown>)[key]=${replacement};const result=setTimeout(cb,1)`,
    false,
  ],
  unionKey: [
    `const key:string|symbol=Math.random()? 'setTimeout':Symbol();(globalThis as Record<string|symbol,unknown>)[key]=${replacement};const result=setTimeout(cb,1)`,
    false,
  ],
  finiteUnionKey: [
    `const key:'metadata'|'description'=Math.random()?'metadata':'description';(globalThis as unknown as Record<'metadata'|'description',unknown>)[key]=true;const result=setTimeout(cb,1)`,
    true,
  ],
  finiteUnionPlatformKey: [
    `const key:'metadata'|'setTimeout'=Math.random()?'metadata':'setTimeout';(globalThis as unknown as Record<'metadata'|'setTimeout',unknown>)[key]=true;const result=setTimeout(cb,1)`,
    false,
  ],
  defineProperty: [
    `Object.defineProperty(globalThis,'setTimeout',{value:${replacement}});const result=setTimeout(cb,1)`,
    false,
  ],
  defineOtherTarget: [
    `Object.defineProperty({},'setTimeout',{value:${replacement}});const result=setTimeout(cb,1)`,
    true,
  ],
  reflectSet: [
    `Reflect.set(globalThis,'setTimeout',${replacement});const result=setTimeout(cb,1)`,
    false,
  ],
  assign: [
    `Object.assign(globalThis,{setTimeout:${replacement}});const result=setTimeout(cb,1)`,
    false,
  ],
  spreadDefineReceiver: [
    `const args=[globalThis,'setTimeout',{value:${replacement}}] as const;Object.defineProperty(...args);const result=setTimeout(cb,1)`,
    false,
  ],
  spreadReflectReceiver: [
    `const args=[globalThis,'setTimeout',${replacement}] as const;Reflect.set(...args);const result=setTimeout(cb,1)`,
    false,
  ],
  spreadAssignReceiver: [
    `const args=[globalThis,{setTimeout:${replacement}}] as const;Object.assign(...args);const result=setTimeout(cb,1)`,
    false,
  ],
  spreadAssignImportedTimer: [
    `import {setTimeout as schedule} from 'node:timers';const args=[globalThis,{setTimeout:${replacement}}] as const;Object.assign(...args);const result=schedule(cb,1)`,
    false,
  ],
  shadowedSpreadMutator: [
    `const Object={assign:(...args:unknown[])=>globalThis};const args=[globalThis,{setTimeout:${replacement}}] as const;Object.assign(...args);const result=setTimeout(cb,1)`,
    true,
  ],
  definePromise: [
    `Object.defineProperty(globalThis,'Promise',{value:class {}});const result=new Promise<void>(resolve=>resolve())`,
    false,
  ],
  reflectPromise: [
    `Reflect.set(globalThis,'Promise',class {});const result=new Promise<void>(resolve=>resolve())`,
    false,
  ],
  assignPromise: [
    `Object.assign(globalThis,{Promise:class {}});const result=new Promise<void>(resolve=>resolve())`,
    false,
  ],
  assignMetadata: [`Object.assign(globalThis,{metadata:true});const result=setTimeout(cb,1)`, true],
  assignSpread: [
    `Object.assign(globalThis,...[{metadata:true}] as const);const result=setTimeout(cb,1)`,
    true,
  ],
  assignSpreadReplacement: [
    `Object.assign(globalThis,...[{setTimeout:${replacement}}] as const);const result=setTimeout(cb,1)`,
    false,
  ],
  assignOtherTarget: [
    `const target={};Object.assign(target,{setTimeout:${replacement}});const result=setTimeout(cb,1)`,
    true,
  ],
  indexedAssign: [
    `const source:Record<string,unknown>={metadata:true};Object.assign(globalThis,source);const result=setTimeout(cb,1)`,
    false,
  ],
  anyAssign: [
    `const source:any={setTimeout:${replacement}};Object.assign(globalThis,source);const result=setTimeout(cb,1)`,
    false,
  ],
  unionAssign: [
    `const source:{setTimeout:typeof setTimeout}|{metadata:boolean}=Math.random()?{setTimeout:${replacement}}:{metadata:true};Object.assign(globalThis,source);const result=setTimeout(cb,1)`,
    false,
  ],
  dynamicAssignSpread: [
    `const sources:object[]=[{metadata:true}];Object.assign(globalThis,...sources);const result=setTimeout(cb,1)`,
    false,
  ],
  nestedAssignSpread: [
    `const sources=[{metadata:true}] as const;Object.assign(globalThis,...[...sources]);const result=setTimeout(cb,1)`,
    false,
  ],
  missingMutatorKey: [
    `// @ts-expect-error Invalid mutator call must remain conservative\nObject.defineProperty(globalThis);const result=setTimeout(cb,1)`,
    false,
  ],
  uninitializedAlias: [
    `// @ts-expect-error The uninitialized alias is not the global object\nlet globals:typeof globalThis;globals.setTimeout=${replacement};const result=setTimeout(cb,1)`,
    true,
  ],
  cyclicAlias: [
    `// @ts-expect-error Invalid alias cycle must fail closed\nlet globals:typeof globalThis=globals;globals.setTimeout=${replacement};const result=setTimeout(cb,1)`,
    true,
  ],
  shadowedMutators: [
    `const Object={assign:(...args:unknown[])=>globalThis,defineProperty:(...args:unknown[])=>globalThis};const Reflect={set:(...args:unknown[])=>true};Object.defineProperty(globalThis,'setTimeout',{value:${replacement}});Reflect.set(globalThis,'setTimeout',${replacement});Object.assign(globalThis,{setTimeout:${replacement}});const result=setTimeout(cb,1)`,
    true,
  ],
  shadowedGlobalThis: [
    `const globalThis={setTimeout:()=>0};globalThis.setTimeout=()=>1;const result=setTimeout(cb,1)`,
    true,
  ],
  deleted: [
    `delete (globalThis as Partial<typeof globalThis>)['setTimeout'];const result=setTimeout(cb,1)`,
    false,
  ],
  unknownProperty: [
    `(globalThis as Record<string,unknown>)['metadata']=true;const result=setTimeout(cb,1)`,
    true,
  ],
  destructured: [
    `({timer:globalThis.setTimeout}={timer:${replacement}});const result=setTimeout(cb,1)`,
    false,
  ],
  alias: [
    `const globals=globalThis;globals.setTimeout=${replacement};const result=setTimeout(cb,1)`,
    false,
  ],
  mutableAlias: [
    `let globals=globalThis;globals['setTimeout']=${replacement};const result=setTimeout(cb,1)`,
    false,
  ],
  constant: [
    `globalThis.setTimeout=${replacement};const schedule=setTimeout;const result=schedule(cb,1)`,
    false,
  ],
  mutableLocalTimer: [
    `let setTimeout:typeof globalThis.setTimeout=globalThis.setTimeout;setTimeout=${replacement};const result=setTimeout(cb,1)`,
    false,
  ],
  interval: [`globalThis.setInterval=${replacement};const result=setInterval(cb,1)`, false],
  promise: [
    `globalThis.Promise=class {} as unknown as typeof Promise;const result=new Promise<void>(resolve=>resolve())`,
    false,
  ],
  untouched: ['const result=setTimeout(cb,1)', true],
  metadata: [
    `(globalThis as Record<symbol,unknown>)[Symbol.for('metadata')]=true;const result=setTimeout(cb,1)`,
    true,
  ],
  unrelated: [`globalThis.setInterval=${replacement};const result=setTimeout(cb,1)`, true],
  shadowed: [
    `const globals={setTimeout:()=>0};globals.setTimeout=()=>1;const result=setTimeout(cb,1)`,
    true,
  ],
  read: ['const original=globalThis.setTimeout;const result=setTimeout(cb,1)', true],
} as const
let root: string
let program: ts.Program
let paths: Record<keyof typeof cases, string>
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'platform-replacements-'))
  paths = Object.fromEntries(
    Object.entries(cases).map(([name, [source]]) => {
      const file = join(root, `${name}.ts`)
      writeFileSync(file, `const cb=()=>{};${source};export {}`)
      return [name, file]
    }),
  ) as Record<keyof typeof cases, string>
  program = ts.createProgram(Object.values(paths), {
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
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
  ).toEqual([])
}, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
afterAll(() => rmSync(root, { recursive: true, force: true }))
function result(source: ts.SourceFile) {
  const statement = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (d) => ts.isIdentifier(d.name) && d.name.text === 'result',
      ),
  ) as ts.VariableStatement
  return statement.declarationList.declarations[0]!.initializer! as
    | ts.CallExpression
    | ts.NewExpression
}
it.each(Object.keys(cases) as (keyof typeof cases)[])(
  'checks actual global writes in %s',
  (name) => {
    const call = result(program.getSourceFile(paths[name])!)
    expect(
      platformCallbackArgument(call, program.getTypeChecker()) ===
        (cases[name][1] ? call.arguments?.[0] : undefined),
    ).toBe(true)
  },
)
it('uses caller compiler library identities when scanning mutator calls', () => {
  registerPlatformCompilerLibraries(program)
  for (const name of ['defineProperty', 'reflectSet', 'assign'] as const) {
    const call = result(program.getSourceFile(paths[name])!)
    expect(platformCallbackArgument(call, program.getTypeChecker())).toBeUndefined()
  }
})
it('rejects a replacement in another program source after caller context registration', () => {
  const file = join(root, 'consumer.ts')
  const mutation = join(root, 'mutation.ts')
  writeFileSync(file, `import './mutation';const cb=()=>{};const result=setTimeout(cb,1);export {}`)
  writeFileSync(mutation, `globalThis.setTimeout=${replacement};export {}`)
  const cross = ts.createProgram([file], program.getCompilerOptions())
  expect(ts.getPreEmitDiagnostics(cross)).toEqual([])
  const call = result(cross.getSourceFile(file)!)
  expect(platformCallbackArgument(call, cross.getTypeChecker())).toBe(call.arguments?.[0])
  registerPlatformCompilerLibraries(cross)
  expect(platformCallbackArgument(call, cross.getTypeChecker()) === undefined).toBe(true)
})
