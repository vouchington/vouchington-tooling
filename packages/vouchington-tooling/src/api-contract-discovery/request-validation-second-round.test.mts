import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  librarySources,
  type ModuleProgram,
} from './request-validation.test-helpers.mts'
import type { FactoryConfig } from './request-validation-types.mts'

const K = "'GET:/api/items'"
const check = (input: string) => `validateInput(ctx, ${K}, ${input})`
const factoryOptions = { optionsArgument: 0, operationProperty: 'operation' }
const factories: readonly FactoryConfig[] = [
  {
    module: 'lib/factory.ts',
    exportName: 'createThingHandler',
    carriers: ['path', 'body'],
    ...factoryOptions,
  },
  {
    module: 'lib/default-factory.ts',
    exportName: 'default',
    carriers: ['query'],
    ...factoryOptions,
  },
]

const handlers: Record<string, string> = {
  'ignored-argument': check('{ body: ignore(await ctx.request.json()) }'),
  'passed-argument': check('{ body: pass(await ctx.request.json()) }'),
  'opaque-argument': check('{ body: JSON.stringify(await ctx.request.json()) }'),
  'prepared-query': check('{ query: pageInput(ctx.query) }'),
  'prepared-spread': check('{ query: { ...pageInput(ctx.query), extra: 1 } }'),
  'iterated-value': check('{ query: lastValue(ctx.query) }'),
  'option-spread-false': 'validatePage(ctx, ' + K + ', { path: true, ...disabled })',
  'option-spread-true': 'validatePage(ctx, ' + K + ', { path: false, ...enabled })',
  'option-spread-unknown': 'validatePage(ctx, ' + K + ', { path: true, ...unknown })',
  'option-unknown-object': 'validatePage(ctx, ' + K + ', unknown)',
  'option-computed': 'validatePage(ctx, ' + K + ', { path: true, [dynamic]: false })',
  'option-missing': 'validatePage(ctx, ' + K + ')',
  'option-literal': 'validatePage(ctx, ' + K + ', { path: true })',
  'option-forwarded': 'page(ctx, { path: true })',
  iife: `((operation: string, raw: unknown) => validateInput(ctx, operation, { body: raw }))('POST:/x', await ctx.request.json())`,
  'write-targets': `ctx.query.synthetic = 'fixed'
    delete ctx.params.removed
    ctx.query = {}
    ctx.query.counter += 1
    ctx.query.step++
    void (ctx.query).paren`,
  'same-line': `if (flag) ${check('{}')}; ${check('{}')}`,
  'helper-object': 'checkInput(ctx, { query: ctx.query })',
  'helper-spread': 'checkInput(ctx, { ...base, path: ctx.params })',
  'helper-nested': 'outer(ctx, { query: ctx.query })',
  'helper-reassigned': 'reassigns(ctx, { query: ctx.query })',
}

const files = {
  ...librarySources,
  'lib/default-factory.ts': `
    import { validateInput } from './validation'
    export default function (options: any) {
      return (ctx: any) => { validateInput(ctx, options.operation, { path: ctx.params }) }
    }
  `,
  'routes/second.ts': `
    import { validateInput, validatePage } from '../lib/validation'
    import { createThingHandler } from '../lib/factory'
    import makeDefault from '../lib/default-factory'
    declare const app: any
    declare const flag: boolean
    declare const unknown: any
    declare const dynamic: string
    function compose(...handlers: unknown[]) { return async (ctx: any) => { void ctx; void handlers } }
    const CONTRACT = {}
    const disabled: Record<string, boolean> = { path: false }
    const enabled: Record<string, boolean> = { path: true }
    const base = { query: 1 as unknown }
    function ignore(raw: unknown) { void raw; return {} }
    function pass(raw: unknown) { return { value: raw } }
    function normalize(value: unknown, contract: unknown) { void contract; return String(value) }
    function prepare(query: Record<string, unknown>, contract: unknown) {
      const prepared: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue
        prepared[key] = normalize(value, contract)
      }
      return prepared
    }
    function pageInput(query: Record<string, unknown>) {
      return Object.fromEntries(
        Object.entries(prepare(query, CONTRACT)).filter(([key]) => key !== 'x'),
      )
    }
    function lastValue(query: Record<string, unknown>) {
      let last: unknown
      for (const value of Object.values(query)) { last = value }
      return last
    }
    function page(ctx: any, options: any) { validatePage(ctx, ${K}, options) }
    function checkInput(ctx: any, input: any) { ${check('input')} }
    function outer(ctx: any, input: any) { checkInput(ctx, input) }
    function reassigns(ctx: any, input: any) { input = {}; ${check('input')} }
    ${Object.entries(handlers)
      .map(([id, body]) => `app.route('/api/${id}').get(async (ctx: any) => { ${body} })`)
      .join('\n')}
    function makeDead() {
      if (false) return (ctx: any) => { ${check('{}')} }
      return (ctx: any) => { void ctx }
    }
    function makeAlive() {
      if (flag) return (ctx: any) => { ${check('{}')} }
      return (ctx: any) => { void ctx }
    }
    function makeDeadFactory() {
      if (false) return createThingHandler({ operation: 'POST:/api/dead-factory' })
      return (ctx: any) => { void ctx }
    }
    function after() {
      return (ctx: any) => { void ctx }
      return (ctx: any) => { ${check('{}')} }
    }
    app.route('/api/dead-return').get(makeDead())
    app.route('/api/alive-return').get(makeAlive())
    app.route('/api/dead-factory').post(makeDeadFactory())
    app.route('/api/after-return').get(after())
    const deadHandler = makeDead()
    app.route('/api/dead-variable').get(deadHandler)
    app.route('/api/default-factory').post(makeDefault({ operation: 'POST:/api/default-factory' }))
    app.route('/api/two-factories').post(compose(createThingHandler({ operation: 'POST:/x' }), createThingHandler({ operation: 'POST:/x' })))
    function build(options: any) { return createThingHandler(options) }
    const baseOptions = { operation: 'POST:/api/forward-spread' }
    app.route('/api/no-operation').post(createThingHandler({ mode: true }))
    app.route('/api/forward').post(build({ operation: 'POST:/api/forward' }))
    app.route('/api/forward-spread').post(build({ ...baseOptions }))
  `,
}

let facts: ReturnType<typeof discover>
const route = (id: string, method = 'GET') => facts[`${method}:/api/${id}`]!
const carriers = (id: string) => route(id).validatorSites[0]!.carriers
const unresolved = (id: string) => route(id).validatorSites[0]!.unresolvedCarriers
const shape = (id: string) =>
  route(id).carrierReads.map(({ carrier, key, access }) => ({ carrier, key, access }))
let built: ModuleProgram

describe('request validation second review round', () => {
  beforeAll(() => {
    built = buildModuleProgram(files)
    facts = discover(built, ['routes/second.ts', 'lib/validation.ts', 'lib/factory.ts'], {
      factories,
    })
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('traces only the values a followed helper returns', () => {
    expect(carriers('ignored-argument')).toEqual([{ carrier: 'body', origins: [] }])
    expect(carriers('passed-argument')).toEqual([{ carrier: 'body', origins: ['body'] }])
    expect(carriers('opaque-argument')).toEqual([{ carrier: 'body', origins: ['body'] }])
  })

  it('keeps origins through helpers that iterate and rebuild the query', () => {
    for (const id of ['prepared-query', 'prepared-spread', 'iterated-value'])
      expect(carriers(id)).toEqual([{ carrier: 'query', origins: ['query'] }])
  })

  it('skips returned values on statically dead paths', () => {
    expect(route('dead-return').validatorSites).toEqual([])
    expect(route('dead-variable').validatorSites).toEqual([])
    expect(route('after-return').validatorSites).toEqual([])
    expect(route('alive-return').validatorSites).toHaveLength(1)
    expect(route('dead-factory', 'POST').factorySites).toEqual([])
  })

  it('resolves fixed-carrier options with last-write-wins spreads', () => {
    const query = { carrier: 'query', origins: ['query'] }
    const path = { carrier: 'path', origins: ['path'] }
    expect(carriers('option-spread-false')).toEqual([query])
    expect(unresolved('option-spread-false')).toBeUndefined()
    expect(carriers('option-spread-true')).toEqual([query, path])
    expect(carriers('option-literal')).toEqual([query, path])
    expect(carriers('option-forwarded')).toEqual([query, path])
    expect(carriers('option-missing')).toEqual([query])
    expect(unresolved('option-missing')).toBeUndefined()
  })

  it('blocks the option carrier and reports unresolvable options', () => {
    expect(carriers('option-spread-unknown')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(unresolved('option-spread-unknown')).toBe('option "path" is not statically resolvable')
    expect(unresolved('option-computed')).toBe('option "path" is not statically resolvable')
    expect(carriers('option-unknown-object')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(unresolved('option-unknown-object')).toBe(
      'options `unknown` are not statically resolvable',
    )
  })

  it('binds the arguments of an inline function call', () => {
    expect(route('iife').validatorSites).toMatchObject([
      { operation: 'POST:/x', carriers: [{ carrier: 'body', origins: ['body'] }] },
    ])
    expect(route('iife').validatorSites[0]).not.toHaveProperty('unresolvedReason')
  })

  it('ignores assignment and delete targets but keeps updates as reads', () => {
    expect(shape('write-targets')).toEqual([
      { carrier: 'query', key: 'counter', access: 'key' },
      { carrier: 'query', key: 'step', access: 'key' },
      { carrier: 'query', key: 'paren', access: 'key' },
    ])
  })

  it('keeps distinct calls on one line', () => {
    expect(route('same-line').validatorSites.map((site) => site.conditional)).toEqual([true, false])
    expect(route('two-factories', 'POST').factorySites).toHaveLength(2)
  })

  it('treats an anonymous default-exported factory as configured', () => {
    expect(route('default-factory', 'POST').validatorSites).toEqual([])
    expect(route('default-factory', 'POST').factorySites).toMatchObject([
      { operation: 'POST:/api/default-factory', carriers: ['query'] },
    ])
  })

  it('resolves object arguments and options through helper parameters', () => {
    expect(carriers('helper-object')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(route('helper-object').carrierReads).toEqual([])
    expect(carriers('helper-nested')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(route('helper-nested').carrierReads).toEqual([])
    expect(carriers('helper-spread')).toEqual([
      { carrier: 'query', origins: [] },
      { carrier: 'path', origins: ['path'] },
    ])
    expect(unresolved('helper-object')).toBeUndefined()
    expect(route('forward', 'POST').factorySites).toMatchObject([
      { operation: 'POST:/api/forward' },
    ])
    expect(route('no-operation', 'POST').factorySites).toMatchObject([{ operation: null }])
    expect(route('forward-spread', 'POST').factorySites).toMatchObject([
      { operation: 'POST:/api/forward-spread' },
    ])
  })

  it('does not resolve a parameter the helper reassigns', () => {
    expect(carriers('helper-reassigned')).toEqual([])
    expect(unresolved('helper-reassigned')).toBe('input `input` is not statically resolvable')
  })
})
