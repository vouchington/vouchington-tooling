import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  librarySources,
  validators,
  type ModuleProgram,
} from './request-validation.test-helpers.mts'

const KEY = "'GET:/api/items'"
const check = (input: string) => `validateInput(ctx, ${KEY}, ${input})`

const handlers: Record<string, string> = {
  'reassigned-replaces': `let value: any = await ctx.request.json()
    value = ctx.query
    ${check('{ body: value }')}`,
  'reassigned-twice': `let value: any = ctx.params
    value = ctx.query
    value = [value]
    ${check('{ body: value }')}`,
  'reassigned-conditional': `let value: any = ctx.params
    if (flag) { value = ctx.query }
    ${check('{ body: value }')}`,
  'reassigned-loop': `let value: any = ctx.params
    for (const item of items) { value = ctx.query; void item }
    ${check('{ body: value }')}`,
  'reassigned-try': `let value: any = ctx.params
    try { value = ctx.query } catch { void 0 }
    ${check('{ body: value }')}`,
  'reassigned-property': `let value: any = ctx.params
    value = {}
    value.limit = ctx.query.limit
    ${check('{ body: value }')}`,
  'reassigned-own-value': `let value: any = ctx.query
    value = [value]
    ${check('{ body: value }')}`,
  'reassigned-after': `let value: any = ctx.params
    ${check('{ body: value }')}
    value = ctx.query`,
  'reassigned-parameter': 'replaceParameter(ctx, await ctx.request.json())',
  'validator-reads': `validateInput((await ctx.request.json(), ctx), ${KEY}, { query: ctx.query.limit })`,
  'validator-nested': check("{ body: validateInput(ctx, 'GET:/api/inner', {}) }"),
  'validator-const-input': `const input = { query: ctx.query.limit, path: ctx.params }
    ${check('input')}`,
  'missing-symbols': `// @ts-expect-error unresolved names
    validateInput(ctx, missingKey, { query: missingValue })
    // @ts-expect-error unresolved names
    validateInput(ctx, ${KEY}, missingInput)`,
  'spread-resolved': `const base = { query: ctx.query.limit, path: ctx.params }
    ${check('{ ...base }')}`,
  'spread-direct-then-spread': `const base = { query: ctx.query, path: ctx.params }
    // @ts-expect-error the spread overwrites the earlier property
    ${check('{ query: ctx.params, ...base }')}`,
  'spread-then-direct': `const base = { query: ctx.query, path: ctx.params }
    ${check('{ ...base, query: ctx.params }')}`,
  'spread-unresolved': check('{ ...unrelated, query: ctx.query }'),
  'spread-cyclic': `// @ts-expect-error alias cycle
    const first: any = { ...second }
    const second: any = { ...first }
    ${check('{ ...first }')}`,
  'computed-key': check('{ [dynamic]: ctx.params }'),
  'non-object-input': check('unrelated'),
  'callback-gated': 'gated(() => { ' + check('{}') + ' })',
  'callback-looped': 'looped(() => { ' + check('{}') + ' })',
  'callback-nested': 'forward(() => { ' + check('{}') + ' })',
  'callback-plain': 'plain(() => { ' + check('{}') + ' })',
}

const files = {
  ...librarySources,
  'lib/dts/validation.d.ts': `
    export declare function checkDts(ctx: any, operation: string, input?: any): boolean
  `,
  'lib/dts/validation-mts.d.mts': `
    export declare function checkMts(ctx: any, operation: string, input?: any): boolean
  `,
  'lib/dts/validation-cts.d.cts': `
    export declare function checkCts(ctx: any, operation: string, input?: any): boolean
  `,
  'routes/declaration-files.ts': `
    import { checkDts } from '../lib/dts/validation'
    import { checkMts } from '../lib/dts/validation-mts.mjs'
    import { checkCts } from '../lib/dts/validation-cts.cjs'
    declare const app: any
    app.route('/api/declared').get(async (ctx: any) => {
      checkDts(ctx, 'GET:/api/dts', { query: ctx.query })
      checkMts(ctx, 'GET:/api/mts', {})
      checkCts(ctx, 'GET:/api/cts', {})
    })
  `,
  'routes/review.ts': `
    import { validateInput } from '../lib/validation'
    import { createThingHandler } from '../lib/factory'
    declare const app: any
    declare const flag: boolean
    declare const items: number[]
    declare const unrelated: any
    declare const dynamic: string
    function replaceParameter(ctx: any, raw: unknown) {
      raw = ctx.query
      ${check('{ body: raw }')}
    }
    function gated(callback: () => void) { if (flag) callback() }
    function looped(callback: () => void) { for (const item of items) { callback(); void item } }
    function forward(callback: () => void) { plain(callback) }
    function plain(callback: () => void) { callback() }
    ${Object.entries(handlers)
      .map(([id, body]) => `app.route('/api/${id}').get(async (ctx: any) => { ${body} })`)
      .join('\n')}
    app.route('/api/discarded').post(async (ctx: any) => {
      createThingHandler({ operation: 'POST:/api/discarded' })
      ctx.status = 204
    })
    app.route('/api/registered').post(createThingHandler({ operation: 'POST:/api/registered' }))
    let mutable = async (ctx: any) => { ${check('{}')} }
    app.route('/api/let-handler').get(mutable)
    let reassigned = async (ctx: any) => { ${check('{}')} }
    reassigned = async () => undefined
    app.route('/api/reassigned-handler').get(reassigned)
    let makeLet = (operation: string) => async (ctx: any) => { validateInput(ctx, operation, {}) }
    app.route('/api/let-factory').get(makeLet('GET:/api/let-factory'))
    const stable = async (ctx: any) => { ${check('{}')} }
    app.route('/api/const-handler').get(stable)
  `,
}

let built: ModuleProgram
let facts: ReturnType<typeof discover>
const route = (id: string, method = 'GET') => facts[`${method}:/api/${id}`]!
const carriers = (id: string) => route(id).validatorSites[0]!.carriers
const conditionals = (id: string) => route(id).validatorSites.map((site) => site.conditional)

describe('request validation review fixes', () => {
  beforeAll(() => {
    built = buildModuleProgram(files)
    facts = discover(built, ['routes/review.ts', 'lib/validation.ts', 'lib/factory.ts'])
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('lets an unconditional reassignment replace the earlier origins', () => {
    expect(carriers('reassigned-replaces')).toEqual([{ carrier: 'body', origins: ['query'] }])
    expect(carriers('reassigned-twice')).toEqual([{ carrier: 'body', origins: ['query'] }])
    expect(carriers('reassigned-own-value')).toEqual([{ carrier: 'body', origins: ['query'] }])
    expect(carriers('reassigned-parameter')).toEqual([{ carrier: 'body', origins: ['query'] }])
  })

  it('merges conditional reassignments and keeps the original value', () => {
    for (const id of ['reassigned-conditional', 'reassigned-loop', 'reassigned-try'])
      expect(carriers(id)).toEqual([{ carrier: 'body', origins: ['path', 'query'] }])
    expect(carriers('reassigned-after')).toEqual([{ carrier: 'body', origins: ['path'] }])
  })

  it('still adds origins from property writes after a replacement', () => {
    expect(carriers('reassigned-property')).toEqual([{ carrier: 'body', origins: ['query'] }])
  })

  it('walks the evaluated arguments of a configured validator', () => {
    expect(route('validator-reads').carrierReads).toEqual([
      { carrier: 'body', key: null, access: 'whole', source: '/virtual/routes/review.ts:44' },
    ])
    expect(route('validator-nested').validatorSites.map((site) => site.operation)).toEqual([
      'GET:/api/items',
      'GET:/api/inner',
    ])
    expect(route('validator-const-input').carrierReads).toEqual([])
    expect(carriers('validator-const-input')).toEqual([
      { carrier: 'query', origins: ['query'] },
      { carrier: 'path', origins: ['path'] },
    ])
  })

  it('reports no factory site for a factory call whose handler is discarded', () => {
    expect(route('discarded', 'POST').factorySites).toEqual([])
    expect(route('registered', 'POST').factorySites).toMatchObject([
      { operation: 'POST:/api/registered' },
    ])
  })

  it('reports unresolved facts instead of throwing for names without symbols', () => {
    expect(route('missing-symbols').validatorSites).toMatchObject([
      {
        operation: null,
        unresolvedReason: 'operation key `missingKey` is not statically resolvable',
        carriers: [{ carrier: 'query', origins: [] }],
      },
      {
        operation: 'GET:/api/items',
        carriers: [],
        unresolvedCarriers: 'input `missingInput` is not statically resolvable',
      },
    ])
  })

  it('resolves input spreads with last-write-wins semantics', () => {
    expect(carriers('spread-resolved')).toEqual([
      { carrier: 'query', origins: ['query'] },
      { carrier: 'path', origins: ['path'] },
    ])
    expect(route('spread-resolved').carrierReads).toEqual([])
    expect(carriers('spread-direct-then-spread')).toEqual([
      { carrier: 'query', origins: ['query'] },
      { carrier: 'path', origins: ['path'] },
    ])
    expect(carriers('spread-then-direct')).toEqual([
      { carrier: 'query', origins: ['path'] },
      { carrier: 'path', origins: ['path'] },
    ])
    expect(route('spread-resolved').validatorSites[0]).not.toHaveProperty('unresolvedCarriers')
  })

  it('marks carriers unresolved for spreads, computed keys and non-object inputs', () => {
    const site = (id: string) => route(id).validatorSites[0]!
    expect(site('spread-unresolved')).toMatchObject({
      carriers: [{ carrier: 'query', origins: ['query'] }],
      unresolvedCarriers: 'spread `unrelated` is not statically resolvable',
    })
    expect(site('spread-cyclic')).toMatchObject({
      carriers: [],
      unresolvedCarriers: 'spread `first` is not statically resolvable',
    })
    expect(site('computed-key')).toMatchObject({
      carriers: [],
      unresolvedCarriers: 'a computed property name is not statically resolvable',
    })
    expect(site('non-object-input')).toMatchObject({
      carriers: [],
      unresolvedCarriers: 'input `unrelated` is not statically resolvable',
    })
  })

  it('does not trust mutable handler bindings', () => {
    for (const id of ['let-handler', 'reassigned-handler', 'let-factory'])
      expect(route(id).validatorSites).toEqual([])
    expect(route('const-handler').validatorSites).toHaveLength(1)
  })

  it('matches declaration files by their module name', () => {
    const configured = ['validation', 'validation-mts', 'validation-cts'].map((name, index) => ({
      ...validators[0]!,
      module: `lib/dts/${name}`,
      exportName: ['checkDts', 'checkMts', 'checkCts'][index]!,
    }))
    const result = discover(built, ['routes/declaration-files.ts'], { validators: configured })
    expect(result['GET:/api/declared']!.validatorSites).toMatchObject([
      { exportName: 'checkDts', operation: 'GET:/api/dts' },
      { exportName: 'checkMts', operation: 'GET:/api/mts' },
      { exportName: 'checkCts', operation: 'GET:/api/cts' },
    ])
  })

  it('takes the invocation condition of a callback run by a followed helper', () => {
    expect(conditionals('callback-gated')).toEqual([true])
    expect(conditionals('callback-looped')).toEqual([true])
    expect(conditionals('callback-plain')).toEqual([false])
    // A callback forwarded through a nested helper is not proven to run, so it is not walked.
    expect(conditionals('callback-nested')).toEqual([])
  })
})
