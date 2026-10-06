import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  additionalInvalid,
  additionalValid,
} from '../test-helpers/typescript-program-additional-fixtures.mts'
import {
  requireInvalid,
  requireValid,
} from '../test-helpers/typescript-program-create-require-fixtures.mts'
import {
  invocationInvalid,
  invocationValid,
} from '../test-helpers/typescript-program-invocation-fixtures.mts'

interface Fixture {
  code: string
  expectedDiagnosticCount?: number
  file: string
}

const OXLINT = resolve('node_modules/.bin/oxlint')
const PLUGIN = resolve('packages/eslint-plugin-vouchington/src/index.mts')
const FILE = 'backend/test-helpers/api-fixtures/contract-schema.mts'

const invalid: Fixture[] = [
  {
    file: FILE,
    code: `import ts from 'typescript'
ts.createProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'namespace'),
    code: `import * as compiler from 'typescript'
compiler?.['createSemanticDiagnosticsBuilderProgram']?.(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'language-service-namespace'),
    code: `import ts from 'typescript'
ts.createLanguageService(host)`,
  },
  {
    file: FILE.replace('contract-schema', 'language-service-named'),
    code: `import { createLanguageService as makeService } from 'typescript'
makeService(host)`,
  },
  {
    file: FILE.replace('contract-schema', 'language-service-extracted'),
    code: `import ts from 'typescript'
const makeService = ts?.createLanguageService
makeService?.(host)`,
  },
  {
    file: FILE.replace('contract-schema', 'named'),
    code: `import { createProgram as makeProgram } from 'typescript'
makeProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'extracted'),
    code: `import ts from 'typescript'
const makeProgram = ts.createIncrementalProgram
makeProgram(options)`,
  },
  {
    file: FILE.replace('contract-schema', 'assigned'),
    code: `import ts from 'typescript'
let makeProgram
makeProgram = ts['createProgram']
makeProgram?.(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'destructured'),
    code: `import ts from 'typescript'
const { createProgram: makeProgram } = ts
makeProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'namespace-alias'),
    code: `import ts from 'typescript'
const compiler = ts
compiler.createEmitAndSemanticDiagnosticsBuilderProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'dynamic'),
    code: `(await import('typescript')).createProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'dynamic-namespace'),
    code: `const compiler = await import('typescript')
compiler.createProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'conditional-namespace-kill'),
    code: `import ts from 'typescript'
let compiler = ts
if (flag) compiler = domainCompiler
compiler.createProgram(files, options)`,
  },
  {
    file: 'backend/test-helpers/api-fixtures/nested/backend-program.mts',
    code: `import ts from 'typescript'
ts.createProgram(files, options)`,
  },
  {
    file: 'backend/test-helpers/api-fixtures/nested/virtual-program.mts',
    code: `import ts from 'typescript'
ts.createProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'destructured-reassigned-multiple'),
    expectedDiagnosticCount: 3,
    code: `import ts from 'typescript'
let { createProgram: makeProgram } = ts
makeProgram(files, options)
makeProgram = ts.createIncrementalProgram
makeProgram(options)
makeProgram(options)`,
  },
  {
    file: FILE.replace('contract-schema', 'destructured-sibling'),
    code: `import ts from 'typescript'
const { createProgram: makeProgram, flatten } = ts
flatten([])
makeProgram(files, options)`,
  },
  ...requireInvalid,
  ...invocationInvalid,
  ...additionalInvalid,
]

const valid: Fixture[] = [
  {
    file: FILE.replace('contract-schema', 'domain-import'),
    code: `import { createProgram } from '@domain/programs'
createProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'domain-language-service'),
    code: `const service = domainCompiler.createLanguageService(host)
service.getProgram()`,
  },
  {
    file: FILE.replace('contract-schema', 'local'),
    code: `function createProgram() { return domainProgram() }
createProgram()`,
  },
  {
    file: FILE.replace('contract-schema', 'parameter-shadow'),
    code: `import ts from 'typescript'
function build(ts: DomainCompiler) { return ts.createProgram() }`,
  },
  {
    file: FILE.replace('contract-schema', 'language-service-shadow'),
    code: `import ts from 'typescript'
function build(ts: DomainCompiler) { return ts.createLanguageService(host) }`,
  },
  {
    file: FILE.replace('contract-schema', 'local-shadow'),
    code: `import ts from 'typescript'
function build() {
  const ts = domainCompiler
  return ts.createProgram()
}`,
  },
  {
    file: FILE.replace('contract-schema', 'type-only'),
    code: `import type { createProgram } from 'typescript'
type Factory = typeof createProgram`,
  },
  {
    file: FILE.replace('contract-schema', 'namespace-latest-kill'),
    code: `import ts from 'typescript'
let compiler = ts
compiler = domainCompiler
compiler.createProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'extraction-without-call'),
    code: `import ts from 'typescript'
const { createProgram: makeProgram } = ts
void makeProgram`,
  },
  {
    file: FILE.replace('contract-schema', 'create-require-other-module'),
    code: `import { createRequire } from 'node:module'
const load = createRequire(import.meta.url)
const compiler = load('@domain/typescript')
compiler.createProgram(files, options)`,
  },
  {
    file: FILE.replace('contract-schema', 'create-require-latest-kill'),
    code: `import { createRequire } from 'node:module'
const load = createRequire(import.meta.url)
let compiler = load('typescript')
compiler = domainCompiler
compiler.createProgram(files, options)`,
  },
  {
    file: 'backend/test-helpers/api-fixtures/backend-program.mts',
    code: `import ts from 'typescript'
ts.createProgram(files, options)`,
  },
  ...requireValid,
  ...invocationValid,
  ...additionalValid,
]

describe('vouchington/typescript-program-location', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'vouchington-program-location-'))
    for (const fixture of [...invalid, ...valid]) {
      const path = join(root, fixture.file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, fixture.code)
    }
    writeFileSync(
      join(root, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off', suspicious: 'off', perf: 'off' },
        jsPlugins: [{ name: 'vouchington', specifier: PLUGIN }],
        plugins: [],
        rules: {
          'vouchington/typescript-program-location': [
            'error',
            {
              modules: ['typescript'],
              factories: [
                'createCompilerHost',
                'createIncrementalCompilerHost',
                'createSolutionBuilderHost',
                'createSolutionBuilderWithWatchHost',
                'createWatchCompilerHost',
                'createAbstractBuilder',
                'createBuilderProgram',
                'createBuilderProgramUsingIncrementalBuildInfo',
                'createEmitAndSemanticDiagnosticsBuilderProgram',
                'createIncrementalProgram',
                'createLanguageService',
                'createProgram',
                'createRedirectedBuilderProgram',
                'createSemanticDiagnosticsBuilderProgram',
                'createSolutionBuilder',
                'createSolutionBuilderWithWatch',
                'createWatchProgram',
                'readBuilderProgram',
              ],
              owners: ['backend/test-helpers/api-fixtures/backend-program.mts'],
              include: ['backend/test-helpers/api-fixtures/**/*.mts'],
              virtualMatrix: {
                moduleBasename: 'virtual-program',
                builder: 'buildVirtualProgramMatrix',
                testModule: 'vitest',
                testHook: 'beforeAll',
                allowLifecycleFiles: ['backend/test-helpers/api-fixtures/virtual-program.test.mts'],
              },
            },
          ],
        },
      }),
    )
  })

  afterAll(() => {
    rmSync(root, { force: true, recursive: true })
  })

  it('reports only compiler factories with TypeScript value provenance', () => {
    const result = spawnSync(OXLINT, ['-c', '.oxlintrc.json', '--format', 'json', '.'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    const { diagnostics } = JSON.parse(result.stdout) as {
      diagnostics: Array<{ filename: string }>
    }
    expect(diagnostics.map(({ filename }) => filename.replace(`${root}/`, '')).toSorted()).toEqual(
      invalid
        .flatMap(({ expectedDiagnosticCount = 1, file }) =>
          Array.from({ length: expectedDiagnosticCount }, () => file),
        )
        .toSorted(),
    )
  })
})
