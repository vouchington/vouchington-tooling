import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  librarySources,
  type ModuleProgram,
} from './request-validation.test-helpers.mts'

const preamble = `
  import { validateInput } from '../lib/validation'
  declare const app: any
`
const route = (body: string, imports = '') => `${imports}${preamble}
  app.route('/api/items').get(async (ctx: any) => { ${body} })`
const call = (key: string) => `validateInput(ctx, ${key}, { query: ctx.query })`
const rules = (module: string, operationArgument = 1) =>
  ({
    module,
    exportName: 'validateInput',
    operationArgument,
    carriers: { kind: 'input-object', argument: 2 },
  }) as const

const files = {
  ...librarySources,
  'routes/literal.ts': route(call("'GET:/api/items'")),
  'routes/no-substitution.ts': route(call('`GET:/api/items`')),
  'routes/const.ts': route(call('KEY'), `const KEY = 'GET:/api/items' as const\n`),
  'routes/satisfies.ts': route(call('KEY'), `const KEY = 'GET:/api/items' satisfies string\n`),
  'routes/imported.ts': route(call('LIST_KEY'), `import { LIST_KEY } from '../lib/keys'\n`),
  'routes/wrong.ts': route(call("'GET:/api/other'")),
  'routes/computed.ts': route(call("['GET', '/api/items'].join(':')")),
  'routes/mutable.ts': route(call('key'), `let key = 'GET:/api/items'\n`),
  'routes/helper.ts': `${preamble}
    const KEY = 'GET:/api/items'
    function check(ctx: any, operation: string) {
      validateInput(ctx, operation, { query: ctx.query })
    }
    function relay(ctx: any, key: string) { check(ctx, key) }
    app.route('/api/items').get((ctx: any) => { check(ctx, KEY) })
    app.route('/api/items/:id').get((ctx: any) => { relay(ctx, 'GET:/api/items/:id') })
    app.route('/api/other').get((ctx: any, key: string) => { check(ctx, key) })
    app.route('/api/unbound').get((ctx: any) => { check(ctx, ctx.query.op) })
  `,
  'routes/local.ts': `
    declare const app: any
    function validateInput(ctx: any, operation: string, input: unknown) {
      return [ctx, operation, input]
    }
    app.route('/api/items').get((ctx: any) => { validateInput(ctx, 'GET:/api/items', {}) })
  `,
  'node_modules/@acme/validation/index.ts': `
    export function validateInput(ctx: any, operation: string, input: unknown): void {
      void [ctx, operation, input]
    }
  `,
  'routes/package.ts': `
    import { validateInput } from '@acme/validation'
    declare const app: any
    app.route('/api/items').get((ctx: any) => { validateInput(ctx, 'GET:/api/items', {}) })
  `,
  'global/script.ts': `function validateScript(ctx: any, operation: string) { void [ctx, operation] }`,
  'routes/global.ts': `
    declare const app: any
    declare const handlers: Record<string, (ctx: any) => void>
    app.route('/api/items').get((ctx: any) => {
      validateScript(ctx, 'GET:/api/items')
      handlers['validate']!(ctx)
    })
  `,
  'routes/alias.ts': `
    import { checkInput } from '../lib/reexport'
    import { validateInput as renamed } from '../lib/validation'
    import * as lib from '../lib/validation'
    import { validateInput as mapped } from '@lib/validation'
    declare const app: any
    app.route('/api/items').get((ctx: any) => {
      checkInput(ctx, 'GET:/api/items', { query: ctx.query })
      renamed(ctx, 'GET:/api/items', { query: ctx.query })
      lib.validateInput(ctx, 'GET:/api/items', { query: ctx.query })
      mapped(ctx, 'GET:/api/items', { query: ctx.query })
    })
  `,
} as const

let built: ModuleProgram
const sites = (id: string, route = 'GET:/api/items', libs = ['lib/validation.ts']) =>
  discover(built, [`routes/${id}.ts`, ...libs])[route]?.validatorSites ?? []
const operations = (id: string) => sites(id).map((site) => site.operation)

describe('request validation operation keys', () => {
  beforeAll(() => {
    built = buildModuleProgram(files)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('resolves literal, template, const, satisfies and imported const keys', () => {
    for (const id of ['literal', 'no-substitution', 'const', 'satisfies'])
      expect(operations(id)).toEqual(['GET:/api/items'])
    expect(sites('imported', 'GET:/api/items', ['lib/validation.ts', 'lib/keys.ts'])).toMatchObject(
      [{ operation: 'GET:/api/items' }],
    )
  })

  it('reports a wrong literal key as written', () => {
    expect(operations('wrong')).toEqual(['GET:/api/other'])
  })

  it('reports computed and mutable keys as null with a reason', () => {
    expect(sites('computed')).toMatchObject([
      {
        operation: null,
        unresolvedReason:
          "operation key `['GET', '/api/items'].join(':')` is not statically resolvable",
      },
    ])
    expect(operations('mutable')).toEqual([null])
  })

  it('reports a missing operation argument', () => {
    const facts = discover(built, ['routes/literal.ts', 'lib/validation.ts'], {
      validators: [rules('lib/validation.ts', 7)],
    })
    expect(facts['GET:/api/items']?.validatorSites).toMatchObject([
      { operation: null, unresolvedReason: 'operation argument is missing' },
    ])
  })

  it('resolves helper parameters bound to literals, consts and relayed arguments', () => {
    const facts = discover(built, ['routes/helper.ts', 'lib/validation.ts'])
    const keys = (route: string) => facts[route]?.validatorSites.map((site) => site.operation)
    expect(keys('GET:/api/items')).toEqual(['GET:/api/items'])
    expect(keys('GET:/api/items/:id')).toEqual(['GET:/api/items/:id'])
    expect(keys('GET:/api/other')).toEqual([null])
    expect(keys('GET:/api/unbound')).toEqual([null])
  })

  it('does not match a same-named local function', () => {
    expect(sites('local')).toEqual([])
  })

  it('matches aliased imports, renamed re-exports, namespace members and path-mapped imports', () => {
    const libs = ['lib/reexport.ts', 'lib/validation.ts']
    expect(sites('alias', 'GET:/api/items', libs).map((site) => site.exportName)).toEqual([
      'validateInput',
      'validateInput',
      'validateInput',
      'validateInput',
    ])
  })

  it('ignores script files and callees that are not named references', () => {
    const script = {
      module: 'global/script.ts',
      exportName: 'validateScript',
      operationArgument: 1,
      carriers: { kind: 'fixed', carriers: ['query'] },
    } as const
    const result = discover(built, ['routes/global.ts', 'global/script.ts'], {
      validators: [script],
    })
    expect(result['GET:/api/items']?.validatorSites).toEqual([])
  })

  it('matches the resolved declaration path, never the import specifier', () => {
    const paths = ['routes/literal.ts', 'lib/validation.ts']
    const mismatched = discover(built, paths, { validators: [rules('other/validation.ts')] })
    expect(mismatched['GET:/api/items']?.validatorSites).toEqual([])
    const partial = discover(built, paths, { validators: [rules('ib/validation.ts')] })
    expect(partial['GET:/api/items']?.validatorSites).toEqual([])
    const extensionless = discover(built, paths, { validators: [rules('./lib/validation')] })
    expect(extensionless['GET:/api/items']?.validatorSites).toHaveLength(1)
  })

  it('matches a package specifier against the resolved package path', () => {
    const paths = ['routes/package.ts', 'node_modules/@acme/validation/index.ts']
    const matched = discover(built, paths, { validators: [rules('@acme/validation')] })
    expect(matched['GET:/api/items']?.validatorSites).toMatchObject([
      { operation: 'GET:/api/items' },
    ])
    expect(discover(built, paths)['GET:/api/items']?.validatorSites).toEqual([])
  })
})
