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

const replacement = '(()=>0) as unknown as typeof setTimeout'
const cases = {
  direct: [`global.setTimeout=${replacement};const result=setTimeout(cb,1)`, false],
  bracket: [`global['setTimeout']=${replacement};const result=setTimeout(cb,1)`, false],
  alias: [
    `const globals=global;globals.setTimeout=${replacement};const result=setTimeout(cb,1)`,
    false,
  ],
  interval: [`global.setInterval=${replacement};const result=setInterval(cb,1)`, false],
  promise: [
    'global.Promise=class {} as unknown as typeof Promise;const result=new Promise<void>(resolve=>resolve())',
    false,
  ],
  defineProperty: [
    `Object.defineProperty(global,'setTimeout',{value:${replacement}});const result=setTimeout(cb,1)`,
    false,
  ],
  reflectSet: [
    `Reflect.set(global,'setTimeout',${replacement});const result=setTimeout(cb,1)`,
    false,
  ],
  assign: [
    `Object.assign(global,{setTimeout:${replacement}});const result=setTimeout(cb,1)`,
    false,
  ],
  untouched: ['const result=setTimeout(cb,1)', true],
  metadata: [`Object.assign(global,{metadata:true});const result=setTimeout(cb,1)`, true],
  differentTimer: [`global.setInterval=${replacement};const result=setTimeout(cb,1)`, true],
  shadow: [
    'const global={setTimeout:()=>0};global.setTimeout=()=>1;const result=setTimeout(cb,1)',
    true,
  ],
  declaredShadow: [
    `declare const global:typeof globalThis;global.setTimeout=${replacement};const result=setTimeout(cb,1)`,
    true,
  ],
  importedShadow: [
    `import {global} from 'project-global';global.setTimeout=${replacement};const result=setTimeout(cb,1)`,
    true,
  ],
} as const
let root: string
let program: ts.Program
let paths: Record<keyof typeof cases, string>
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'node-global-mutations-'))
  writeFileSync(
    join(root, 'foreign.d.ts'),
    "declare module 'project-global' {export const global:typeof globalThis}",
  )
  paths = Object.fromEntries(
    Object.entries(cases).map(([name, [source]]) => {
      const file = join(root, `${name}.ts`)
      writeFileSync(file, `const cb=()=>{};${source};export {}`)
      return [name, file]
    }),
  ) as Record<keyof typeof cases, string>
  program = ts.createProgram([...Object.values(paths), join(root, 'foreign.d.ts')], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    typeRoots: [join(process.cwd(), 'node_modules/@types')],
    types: ['node'],
  })
  expect(ts.getPreEmitDiagnostics(program)).toEqual([])
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
  'checks compiler-resolved Node global %s',
  (name) => {
    const call = result(program.getSourceFile(paths[name])!)
    expect(platformCallbackArgument(call, program.getTypeChecker())).toBe(
      cases[name][1] ? call.arguments?.[0] : undefined,
    )
  },
)
it('rejects a Node global mutation in another registered program source', () => {
  const consumer = join(root, 'consumer.ts')
  const mutation = join(root, 'mutation.ts')
  writeFileSync(
    consumer,
    "import './mutation';const cb=()=>{};const result=setTimeout(cb,1);export {}",
  )
  writeFileSync(mutation, `global.setTimeout=${replacement};export {}`)
  const cross = ts.createProgram([consumer], program.getCompilerOptions())
  expect(ts.getPreEmitDiagnostics(cross)).toEqual([])
  const call = result(cross.getSourceFile(consumer)!)
  expect(platformCallbackArgument(call, cross.getTypeChecker())).toBe(call.arguments?.[0])
  registerPlatformCompilerLibraries(cross)
  expect(platformCallbackArgument(call, cross.getTypeChecker())).toBeUndefined()
})

it('does not trust a project declaration named global without Node typings', () => {
  const consumer = join(root, 'project-consumer.ts')
  const declaration = join(root, 'project-global.d.ts')
  writeFileSync(declaration, 'declare const global:typeof globalThis')
  writeFileSync(
    consumer,
    `const cb=()=>{};global.setTimeout=${replacement};const result=setTimeout(cb,1);export {}`,
  )
  const project = ts.createProgram([consumer, declaration], {
    ...program.getCompilerOptions(),
    types: [],
  })
  expect(ts.getPreEmitDiagnostics(project)).toEqual([])
  const call = result(project.getSourceFile(consumer)!)
  registerPlatformCompilerLibraries(project)
  expect(platformCallbackArgument(call, project.getTypeChecker())).toBe(call.arguments?.[0])
})
