import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  librarySources,
  type ModuleProgram,
} from './request-validation.test-helpers.mts'

const K = "'GET:/api/items'"
const check = (input: string) => `validateInput(ctx, ${K}, ${input})`

/** One route per entry; each body runs inside `async (ctx: any) => { ... }`. */
const handlers: Record<string, string> = {
  'mutated-input': `const input: any = { path: ctx.params }; input.path = {}; ${check('input')}`,
  'computed-write': `const input: any = { path: ctx.params }; input['pa' + 'th'] = {}; ${check('input')}`,
  'deleted-key': `const input: any = { path: ctx.params }; delete input.path; ${check('input')}`,
  'assigned-over': `const input: any = { path: ctx.params }; Object.assign(input, extra); ${check('input')}`,
  'compound-write': `const input: any = { path: ctx.params }; (input as any).n += 1; ${check('input')}`,
  incremented: `const input: any = { path: ctx.params }; input.n++; ++input.m; ${check('input')}`,
  'write-after-use': `const input: any = { path: ctx.params }; ${check('input')}; input.path = {}`,
  'unwritten-input': `const input: any = { path: ctx.params }; let n = 0; n++; void !flag; Object.keys(input); other.assign(input); ${check('input')}`,
  'assign-nothing': `// @ts-expect-error no target\n Object.assign(); const input: any = { path: ctx.params }; ${check('input')}`,
  'module-mutated': check('moduleInput'),
  'module-clean': check('moduleClean'),
  'imported-mutated': check('sharedInput'),
  'reassigned-key': `recheck(ctx, 'GET:/api/old')`,
  'maybe-key': `maybe(ctx, 'GET:/api/old')`,
  'twice-key': `twice(ctx, 'GET:/api/old')`,
  'dynamic-key': `dynamicKey(ctx, 'GET:/api/old')`,
  'kept-key': `keeps(ctx, 'GET:/api/old')`,
  'dead-assignment': `let value = ctx.params; if (false) value = ctx.query; ${check('{ body: value }')}`,
  'live-assignment': `let value = ctx.params; if (flag) value = ctx.query; ${check('{ body: value }')}`,
  'generator-helper': `deferred(ctx)`,
  'generator-inline': `(function* (c: any) { validateInput(c, ${K}, {}) })(ctx)`,
  'prepared-inline-helper': check('{ query: prepare(ctx.query) }'),
  'prepared-declared': `const input = { query: prepare(ctx.query) }; ${check('input')}`,
  'prepared-and-read': `${check('{ query: prepare(ctx.query) }')}; prepare(ctx.query)`,
  'pair-chosen': `const pair: any = { chosen: ctx.query, unused: ctx.params }; const { chosen } = pair; ${check('{ body: chosen }')}`,
  'pair-renamed': `const pair: any = { chosen: ctx.query, unused: ctx.params }; const { 'chosen': renamed } = pair; ${check('{ body: renamed }')}`,
  'tuple-second': `const tuple = [ctx.query, ctx.params]; const [, second] = tuple; ${check('{ body: second }')}`,
  'tuple-spread': `const list = [...many, ctx.query, ctx.params]; const [, second] = list; ${check('{ body: second }')}`,
  'helper-object': `const { b } = split(ctx); ${check('{ body: b }')}`,
  'helper-awaited': `const { b: awaited } = await split(ctx); ${check('{ body: awaited }')}`,
  'helper-tuple': `const [first] = pairOf(ctx); ${check('{ body: first }')}`,
  'helper-opaque': `const { x } = opaque(ctx); ${check('{ body: x }')}`,
  'helper-loop': `const { z } = loop(ctx); ${check('{ body: z }')}`,
  'helper-nested': `const { b: y } = nested(ctx); ${check('{ body: y }')}`,
  'rest-binding': `const pair: any = { chosen: ctx.query, unused: ctx.params }; const { ...rest } = pair; ${check('{ body: rest }')}`,
  'computed-binding': `const pair: any = { chosen: ctx.query, unused: ctx.params }; const { [dynamic]: anyVal } = pair; ${check('{ body: anyVal }')}`,
  'absent-default': `const pair: any = { chosen: ctx.query }; const { absent = ctx.params } = pair; ${check('{ body: absent }')}`,
  'mutated-pair': `const pair: any = { chosen: ctx.query }; pair.chosen = ctx.params; const { chosen } = pair; ${check('{ body: chosen }')}`,
  'alias-source': `const alias = ctx.query; const { x } = alias; ${check('{ body: x }')}`,
  'tuple-short': `const short = [ctx.query]; const [, missing] = short; ${check('{ body: missing }')}`,
  'array-source': `const [e] = ctx.query; ${check('{ body: e }')}`,
  'cyclic-consts': `const { q } = cycleA; ${check('{ body: q }')}`,
  'self-reference': `// @ts-expect-error self reference\n const { selfRef } = pick(selfRef); ${check('{ body: selfRef }')}`,
  'unknown-pair': `const { chosen } = unknown; ${check('{ body: chosen }')}`,
}

const destructured: Record<string, string> = {
  'destructured-validated': `async ({ query, params, request }: any) => { validateInput(request, ${K}, { query, path: params, body: await request.json() }) }`,
  'destructured-reads': `({ query, params: p, headers }: any) => { consume(query.limit); consume(p.id); consume(headers.authorization) }`,
  'destructured-nested': `({ request: { query } }: any) => { consume(query.page) }`,
  'destructured-unbound': `({ other, [dynamic]: value, query = {}, ...rest }: any) => { consume(other.x); consume(rest.y); consume(value.z) }`,
  'destructured-array': `([first]: any) => { consume(first.x) }`,
}

const files = {
  ...librarySources,
  'lib/shared-input.ts': `
    export const sharedInput = { query: 'x' as unknown }
    sharedInput.query = 'y'
  `,
  'routes/third.ts': `
    import { validateInput, validatePage } from '../lib/validation'
    import { createThingHandler } from '../lib/factory'
    import { sharedInput } from '../lib/shared-input'
    declare const app: any
    declare const flag: boolean
    declare const unknown: any
    declare const dynamic: string
    declare const extra: object
    declare const many: unknown[]
    declare const other: any
    declare const setupCtx: any
    declare function consume(value: unknown): void
    function compose(...handlers: unknown[]) { return async (ctx: any) => { void ctx; void handlers } }
    const moduleInput = { query: 1 as unknown }
    moduleInput.query = 2
    const moduleClean = { query: 1 as unknown }
    const mutatedOptions = { operation: 'POST:/api/mutated-factory' }
    mutatedOptions.operation = 'POST:/api/other'
    function recheck(ctx: any, op: string) { op = 'POST:/api/new'; validateInput(ctx, op, {}) }
    function maybe(ctx: any, op: string) { if (flag) op = 'POST:/api/new'; validateInput(ctx, op, {}) }
    function twice(ctx: any, op: string) { op = 'POST:/a'; if (flag) op = 'POST:/b'; validateInput(ctx, op, {}) }
    function dynamicKey(ctx: any, op: string) { op = dynamic; validateInput(ctx, op, {}) }
    function keeps(ctx: any, op: string) { op = op; validateInput(ctx, op, {}) }
    function* deferred(ctx: any) { validateInput(ctx, ${K}, {}) }
    function prepare(query: Record<string, unknown>) { return query.limit }
    function split(ctx: any) { return { a: ctx.query, b: ctx.params } }
    function pairOf(ctx: any) { return [ctx.params, ctx.query] }
    // @ts-expect-error cyclic const
    const cycleA: any = cycleB
    const cycleB: any = cycleA
    function pick(value: any) { return { selfRef: value } }
    function opaque(ctx: any) { return ctx.query }
    function loop(ctx: any): any { return loop(ctx) }
    function nested(ctx: any) { return split(ctx) }
    ${Object.entries(handlers)
      .map(([id, body]) => `app.route('/api/${id}').get(async (ctx: any) => { ${body}\n })`)
      .join('\n')}
    ${Object.entries(destructured)
      .map(([id, handler]) => `app.route('/api/${id}').get(${handler})`)
      .join('\n')}
    app.route('/api/setup-compose').get(compose(validatePage(setupCtx, ${K}, { path: true }), async (ctx: any) => { void ctx }))
    const setupHandler = (validatePage(setupCtx, ${K}), async (ctx: any) => { void ctx })
    app.route('/api/setup-variable').get(setupHandler)
    function makeAlive() {
      if (flag) return (ctx: any) => { ${check('{}')} }
      return (ctx: any) => { void ctx }
    }
    function makeAlways() { return (ctx: any) => { ${check('{}')} } }
    function makeNested() {
      if (flag) return makeAlways()
      return (ctx: any) => { void ctx }
    }
    app.route('/api/conditional-handler').get(makeAlive())
    app.route('/api/always-handler').get(makeAlways())
    app.route('/api/nested-handler').get(makeNested())
    app.route('/api/mutated-factory').post(createThingHandler(mutatedOptions))
    app.route('/api/mutated-factory-assign').post(createThingHandler(Object.assign({ operation: 'POST:/x' }, extra)))
  `,
}

let facts: ReturnType<typeof discover>
let built: ModuleProgram
const route = (id: string, method = 'GET') => facts[`${method}:/api/${id}`]!
const site = (id: string) => route(id).validatorSites[0]!
const carriers = (id: string) => site(id).carriers
const query = { carrier: 'query', origins: ['query'] }
const path = { carrier: 'path', origins: ['path'] }
const body = (...origins: string[]) => [{ carrier: 'body', origins }]
const shape = (id: string) =>
  route(id).carrierReads.map(({ carrier, key, access }) => ({ carrier, key, access }))

describe('request validation third review round', () => {
  beforeAll(() => {
    built = buildModuleProgram(files)
    facts = discover(built, ['routes/third.ts', 'lib/validation.ts', 'lib/factory.ts'])
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('does not report validators evaluated while the handler is built', () => {
    expect(route('setup-compose').validatorSites).toEqual([])
    expect(route('setup-variable').validatorSites).toEqual([])
  })

  it('treats a const object written before the use as unresolvable', () => {
    for (const id of [
      'mutated-input',
      'computed-write',
      'deleted-key',
      'assigned-over',
      'compound-write',
      'incremented',
      'module-mutated',
      'imported-mutated',
    ]) {
      expect(carriers(id), id).toEqual([])
      expect(site(id).unresolvedCarriers).toMatch(/is not statically resolvable$/)
    }
    expect(site('mutated-input').unresolvedCarriers).toBe(
      'input `input` is not statically resolvable',
    )
  })

  it('keeps resolving a const object that is not written before the use', () => {
    for (const id of ['write-after-use', 'unwritten-input', 'assign-nothing'])
      expect(carriers(id), id).toEqual([path])
    expect(carriers('module-clean')).toEqual([{ carrier: 'query', origins: [] }])
    expect(site('module-clean').unresolvedCarriers).toBeUndefined()
  })

  it('gives a factory whose options object was written no operation', () => {
    const unresolvedReason = 'option "operation" is not statically resolvable'
    for (const id of ['mutated-factory', 'mutated-factory-assign'])
      expect(route(id, 'POST').factorySites).toMatchObject([
        { operation: null, unresolvedReason, carriers: ['path', 'body'] },
      ])
  })

  it('uses the reaching write of a reassigned operation key parameter', () => {
    expect(site('reassigned-key').operation).toBe('POST:/api/new')
    expect(site('kept-key').operation).toBe('GET:/api/old')
    for (const id of ['maybe-key', 'twice-key', 'dynamic-key']) {
      expect(site(id).operation, id).toBeNull()
      expect(site(id).unresolvedReason).toMatch(/is not statically resolvable$/)
    }
  })

  it('drops assignments on statically dead paths from origins', () => {
    expect(carriers('dead-assignment')).toEqual(body('path'))
    expect(carriers('live-assignment')).toEqual(body('path', 'query'))
  })

  it('does not run generator helpers', () => {
    expect(route('generator-helper').validatorSites).toEqual([])
    expect(route('generator-inline').validatorSites).toEqual([])
  })

  it('binds destructured handler context parameters to their carriers', () => {
    expect(site('destructured-validated').carriers).toEqual([
      { carrier: 'query', origins: ['query'] },
      { carrier: 'path', origins: ['path'] },
      { carrier: 'body', origins: ['body'] },
    ])
    expect(route('destructured-validated').carrierReads).toEqual([])
    expect(shape('destructured-reads')).toEqual([
      { carrier: 'query', key: 'limit', access: 'key' },
      { carrier: 'path', key: 'id', access: 'key' },
      { carrier: 'header', key: 'authorization', access: 'key' },
    ])
    expect(shape('destructured-nested')).toEqual([{ carrier: 'query', key: 'page', access: 'key' }])
    expect(shape('destructured-unbound')).toEqual([])
    expect(shape('destructured-array')).toEqual([])
  })

  it('suppresses reads inside a helper that only builds a validator input', () => {
    for (const id of ['prepared-inline-helper', 'prepared-declared']) {
      expect(carriers(id), id).toEqual([query])
      expect(route(id).carrierReads, id).toEqual([])
    }
    expect(shape('prepared-and-read')).toEqual([
      { carrier: 'query', key: 'limit', access: 'key' },
      { carrier: 'query', key: null, access: 'whole' },
    ])
  })

  it('marks a handler selected under a runtime branch conditional', () => {
    expect(route('conditional-handler').validatorSites).toMatchObject([{ conditional: true }])
    expect(route('nested-handler').validatorSites).toMatchObject([{ conditional: true }])
    expect(route('always-handler').validatorSites).toMatchObject([{ conditional: false }])
  })

  it('traces only the selected member of destructured locals', () => {
    expect(carriers('pair-chosen')).toEqual(body('query'))
    expect(carriers('pair-renamed')).toEqual(body('query'))
    expect(carriers('tuple-second')).toEqual(body('path'))
    expect(carriers('helper-object')).toEqual(body('path'))
    expect(carriers('helper-awaited')).toEqual(body('path'))
    expect(carriers('helper-tuple')).toEqual(body('path'))
    expect(carriers('helper-nested')).toEqual(body('path'))
    expect(carriers('absent-default')).toEqual(body('path'))
  })

  it('falls back to the whole initializer when the member cannot be selected', () => {
    for (const id of ['tuple-spread', 'rest-binding', 'computed-binding', 'mutated-pair'])
      expect(carriers(id), id).toEqual(body('path', 'query'))
    expect(carriers('alias-source')).toEqual(body('query'))
    expect(carriers('tuple-short')).toEqual(body())
    expect(carriers('array-source')).toEqual(body('query'))
    expect(carriers('cyclic-consts')).toEqual(body())
    expect(carriers('self-reference')).toEqual(body())
    expect(carriers('helper-opaque')).toEqual(body('query'))
    expect(carriers('helper-loop')).toEqual(body())
    expect(carriers('unknown-pair')).toEqual(body())
    expect(site('unknown-pair').unresolvedCarriers).toBeUndefined()
  })
})
