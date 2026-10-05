import { beforeAll, describe, expect, it } from 'vitest'

import ts from '../contract-schema/typescript-api.mts'
import { discoverRequestValidationFacts } from './request-validation-facts.mts'
import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  librarySources,
  validators,
} from './request-validation.test-helpers.mts'

const K = "'GET:/api/items'"

const files = {
  ...librarySources,
  'lib/dts-validation.d.ts': `export declare function validateInput(ctx: any, operation: string, input?: any): boolean`,
  'lib/mjs-validation.mts': `export function validateInput(ctx: any, operation: string, input?: any): boolean { return !!(ctx && operation && input) }`,
  'routes/fourth.ts': `
    import { validateInput } from '../lib/validation'
    import { validateInput as fromDts } from '../lib/dts-validation'
    import { validateInput as fromMts } from '../lib/mjs-validation.mjs'
    declare const app: any
    function makeHandler(operation: string) {
      return async (ctx: any) => { validateInput(ctx, operation, { query: ctx.query }) }
    }
    function outer(op: string) { return makeHandler(op) }
    app.route('/api/chained').get(outer(${K}))
    app.route('/api/dts').get(async (ctx: any) => { fromDts(ctx, ${K}, {}) })
    app.route('/api/mts').get(async (ctx: any) => { fromMts(ctx, ${K}, {}) })
  `,
}

const withModule = (module: string) => [{ ...validators[0]!, module }]

describe('request validation fourth review round', () => {
  let built: ReturnType<typeof buildModuleProgram>
  beforeAll(() => {
    built = buildModuleProgram(files)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)
  const paths = [
    'routes/fourth.ts',
    'lib/validation.ts',
    'lib/dts-validation.d.ts',
    'lib/mjs-validation.mts',
  ]
  const operations = (module: string, id: string) =>
    discover(built, paths, { validators: withModule(module) })[
      `GET:/api/${id}`
    ]!.validatorSites.map((site) => site.operation)

  it('resolves a proof binding against the keys already bound', () => {
    expect(discover(built, paths)['GET:/api/chained']!.validatorSites).toMatchObject([
      { operation: 'GET:/api/items' },
    ])
  })

  it('matches a configured module written with an extension', () => {
    for (const module of ['lib/validation.ts', 'lib/validation.js', 'lib/validation'])
      expect(operations(module, 'chained')).toEqual(['GET:/api/items'])
    expect(operations('lib/other.js', 'chained')).toEqual([])
  })

  it('matches declaration and module-extension files in both directions', () => {
    for (const module of [
      'lib/dts-validation.ts',
      'lib/dts-validation.js',
      'lib/dts-validation.d.ts',
    ])
      expect(operations(module, 'dts')).toEqual(['GET:/api/items'])
    for (const module of ['lib/mjs-validation.mts', 'lib/mjs-validation.mjs', 'lib/mjs-validation'])
      expect(operations(module, 'mts')).toEqual(['GET:/api/items'])
  })

  it('keeps no write memo across programs that share a source file', () => {
    const first = buildModuleProgram({
      ...librarySources,
      'routes/shared.ts': `
        import { validateInput } from '../lib/validation'
        declare const app: any
        app.route('/api/m').get(async (ctx: any) => {
          const input: any = { path: ctx.params }; input.path = {}
          validateInput(ctx, ${K}, input)
        })
      `,
    })
    const reused = new Map(first.program.getSourceFiles().map((file) => [file.fileName, file]))
    const options = first.program.getCompilerOptions()
    const host = ts.createCompilerHost(options, true)
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (name, ...rest) => reused.get(name) ?? getSourceFile(name, ...rest)
    host.fileExists = (name) => reused.has(name) || ts.sys.fileExists(name)
    host.directoryExists = (name) =>
      [...reused.keys()].some((file) => file.startsWith(`${name.replace(/\/$/, '')}/`)) ||
      !!ts.sys.directoryExists(name)
    host.readFile = (name) => reused.get(name)?.text ?? ts.sys.readFile(name)
    const second = ts.createProgram(first.program.getRootFileNames(), options, host)
    const run = (program: ts.Program) =>
      discoverRequestValidationFacts({
        program,
        sourceFiles: ['routes/shared.ts', 'lib/validation.ts'].map((path) =>
          program.getSourceFile(`/virtual/${path}`)!,
        ),
        validators,
      })['GET:/api/m']!.validatorSites[0]!
    for (const program of [first.program, second, first.program, second]) {
      const site = run(program)
      expect(site.carriers).toEqual([])
      expect(site.unresolvedCarriers).toBe('input `input` is not statically resolvable')
    }
  })
})
