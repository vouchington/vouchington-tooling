import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { platformCallbackArgument } from './protocol-platform-callbacks.mts'

const cases = {
  interval: ['const result=setInterval(cb,1)', true],
  timeout: ['const result=setTimeout(cb,1)', true],
  promise: ['const result=new Promise<void>(resolve=>resolve())', true],
  'imported-interval': [
    "import {setInterval as schedule} from 'node:timers';const result=schedule(cb,1)",
    true,
  ],
  'imported-timeout': [
    "import {setTimeout as schedule} from 'node:timers';const result=schedule(cb,1)",
    true,
  ],
  'legacy-import': [
    "import {setInterval as schedule} from 'timers';const result=schedule(cb,1)",
    true,
  ],
  'promise-timer': [
    "import {setInterval as schedule} from 'node:timers/promises';const result=schedule(1,cb)",
    false,
  ],
  'constant-timer-alias': ['const schedule=setInterval;const result=schedule(cb,1)', true],
  'mutable-timer-alias': ['let schedule=setInterval;const result=schedule(cb,1)', false],
  'timer-alias-cycle': [
    '// @ts-expect-error Invalid runtime alias cycle must fail closed\nconst schedule:typeof setInterval=schedule;const result=schedule(cb,1)',
    false,
  ],
  'missing-timer-argument': [
    '// @ts-expect-error Invalid runtime timer call has no callback\nconst result=setTimeout()',
    false,
  ],
  'missing-promise-argument': [
    '// @ts-expect-error Invalid runtime constructor has no executor\nconst result=new Promise<void>',
    false,
  ],
  'spread-timer-argument': ['const result=setInterval(...([cb,1] as const))', false],
  'missing-symbol': [
    '// @ts-expect-error Unresolved platform registration must fail closed\nconst result=missing(cb)',
    false,
  ],
  'import-alias-cycle': [
    "import {schedule as imported} from './import-alias-cycle';export const schedule:typeof setInterval=imported;const result=schedule(cb,1)",
    false,
  ],
  'shadowed-timer': [
    'function setInterval(callback:()=>void,delay:number){return 0};const result=setInterval(cb,1)',
    false,
  ],
  'declared-timer': [
    'declare function setInterval(callback:()=>void,delay:number):number;const result=setInterval(cb,1)',
    false,
  ],
  'project-import': [
    "import {setInterval as schedule} from './custom';const result=schedule(cb,1)",
    false,
  ],
  'shadowed-promise': [
    'class Promise<T>{constructor(callback:(resolve:()=>void)=>void){}};const result=new Promise<void>(cb)',
    false,
  ],
  'optional-timer': ['const result=setInterval?.(cb,1)', false],
  'called-promise': [
    '// @ts-expect-error Promise construction requires new\nconst result=Promise(cb)',
    false,
  ],
  'new-timer': [
    '// @ts-expect-error Timers are not constructors\nconst result=new setInterval(cb,1)',
    false,
  ],
  'wrong-global': ['const result=queueMicrotask(cb)', false],
  'member-timer': [
    "import * as timers from 'node:timers';const result=timers.setInterval(cb,1)",
    false,
  ],
} as const
let root: string
let program: ts.Program
let paths: Record<keyof typeof cases, string>

describe('compiler-resolved platform callback registrations', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'protocol-platform-'))
    writeFileSync(
      join(root, 'custom.d.ts'),
      'export declare function setInterval(callback:()=>void,delay:number):number',
    )
    paths = Object.fromEntries(
      Object.entries(cases).map(([name, [source]]) => {
        const file = join(root, `${name}.ts`)
        writeFileSync(file, `const cb=()=>{};\n${source};\nexport {}`)
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
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  it.each(Object.keys(cases) as (keyof typeof cases)[])(
    'checks actual declaration provenance in %s',
    (name) => {
      const source = program.getSourceFile(paths[name])!
      const statement = source.statements.find(
        (node) =>
          ts.isVariableStatement(node) &&
          node.declarationList.declarations.some(
            (declaration) =>
              ts.isIdentifier(declaration.name) && declaration.name.text === 'result',
          ),
      ) as ts.VariableStatement
      const call = statement.declarationList.declarations[0]!.initializer!
      if (!ts.isCallExpression(call) && !ts.isNewExpression(call))
        throw new Error('Fixture is not a registration')
      const value = platformCallbackArgument(call, program.getTypeChecker())
      const symbol = program.getTypeChecker().getSymbolAtLocation(call.expression)
      const target =
        symbol && symbol.flags & ts.SymbolFlags.Alias
          ? program.getTypeChecker().getAliasedSymbol(symbol)
          : symbol
      expect(
        value === (cases[name][1] ? call.arguments?.[0] : undefined),
        JSON.stringify({
          name: target?.name,
          defaultLib: ts.getDefaultLibFilePath({}),
          declarations: target?.declarations?.map((declaration) => ({
            file: declaration.getSourceFile().fileName,
            standard: declaration.getSourceFile().hasNoDefaultLib,
          })),
        }),
      ).toBe(true)
    },
  )
})
