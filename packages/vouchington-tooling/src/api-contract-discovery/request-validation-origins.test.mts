import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  librarySources,
  type ModuleProgram,
} from './request-validation.test-helpers.mts'

const KEY = "'GET:/api/items'"
const check = (input: string) => `validateInput(ctx, ${KEY}, ${input})`

const handlers: Record<string, string> = {
  'query-helper': check('{ query: helper(ctx.query, {}) }'),
  'query-assigned': `const query: any = helper(ctx.query, {})
    query.limit = 5
    ${check('{ query }')}`,
  'identifier-assigned': `let value: any = {}
    value = ctx.params
    ${check('{ path: value }')}`,
  'late-assignment': `const late: any = {}
    ${check('{ query: late }')}
    late.x = ctx.query`,
  ternary: check('{ query: flag ? { x: ctx.query.x } : {} }'),
  'ternary-test': check('{ query: ctx.params.x ? ctx.query : {} }'),
  'bound-body': 'withBody(ctx, await ctx.request.json())',
  'path-as-body': check('{ body: ctx.params }'),
  unrelated: check('{ body: await unrelated.request.json() }'),
  'no-argument': 'noArgument(ctx)',
  logical: check(
    "{ query: ctx.query || {}, body: ctx.params ?? ctx.query, header: flag && ctx.get('x') }",
  ),
  spreads: check('{ body: [...[ctx.params], { ...ctx.query }] }'),
  destructured: `const { query } = ctx
    ${check('{ query }')}`,
  'body-helper': `const body = await readBody(ctx)
    ${check('{ body }')}`,
  pick: check('{ query: pick(ctx) }'),
  constant: check('{ body: await constantBody(ctx) }'),
  cycle: check('{ body: loop(ctx.query) }'),
  members: check("{ header: ctx.get('a'), query: ctx.request.query, path: ctx.headers.x }"),
  element: check("{ query: ctx.query['x'] }"),
  wrapped: check('{ body: String(ctx.params.id) }'),
  repeated: check('{ query: same(ctx.query), path: same(ctx.params) }'),
  'nested-helper': check('{ query: nested(ctx) }'),
  'destructured-param': check('{ query: fromPattern({ a: 1 }) }'),
  'repeated-identifier': `const body = await readBody(ctx)
    ${check('{ body: [body, body] }')}`,
  'non-identifier-write': `const target: any = {}
    getObject().x = 1
    ${check('{ query: target }')}`,
  'bare-let': `let bare: any
    bare = ctx.params
    ${check('{ path: bare }')}`,
  cyclic: `// @ts-expect-error alias cycle
    const first: any = second
    const second: any = first
    ${check('{ query: first }')}`,
  'undefined-value': check('{ query: undefined, body: usesArguments() }'),
  'input-keys': check("{ 'query': ctx.query, [dynamic]: ctx.params }"),
  catching: check('{ body: await ctx.request.json().catch(() => ({})) }'),
}

const files = {
  ...librarySources,
  'routes/origins.ts': `
    import { validateInput } from '../lib/validation'
    declare const app: any
    declare const unrelated: any
    declare const flag: boolean
    function helper(value: unknown, contract: unknown) { return [value, contract][0] }
    function readBody(ctx: any) { return ctx.request.json() }
    function constantBody(ctx: any) { void ctx; return { fixed: 1 } }
    const pick = (context: any) => context.query
    function loop(value: any): any { return flag ? loop(value) : value }
    declare const dynamic: string
    declare function getObject(): any
    function nested(ctx: any) { const inner = () => 1; void inner; return ctx.query }
    function fromPattern({ a }: any) { return a }
    function usesArguments() { return arguments }
    function same(value: unknown) { return value }
    function withBody(ctx: any, raw: unknown) { ${check('{ body: raw }')} }
    function noArgument(ctx: any, raw?: unknown) { ${check('{ body: raw }')} }
    ${Object.entries(handlers)
      .map(([id, body]) => `app.route('/api/${id}').get(async (ctx: any) => { ${body} })`)
      .join('\n')}
    app.route('/api/extra').get(async (ctx: any, extra: any) => { ${check('{ body: extra }')} })
  `,
}

let built: ModuleProgram
let facts: ReturnType<typeof discover>
const carriers = (route: string) => facts[`GET:/api/${route}`]!.validatorSites[0]!.carriers

describe('request validation carrier origins', () => {
  beforeAll(() => {
    built = buildModuleProgram(files)
    facts = discover(built, ['routes/origins.ts', 'lib/validation.ts'])
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('keeps origins through calls and later property writes', () => {
    expect(carriers('query-helper')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(carriers('query-assigned')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(carriers('identifier-assigned')).toEqual([{ carrier: 'path', origins: ['path'] }])
    expect(carriers('late-assignment')).toEqual([{ carrier: 'query', origins: [] }])
  })

  it('unions conditional branches without the test', () => {
    expect(carriers('ternary')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(carriers('ternary-test')).toEqual([{ carrier: 'query', origins: ['query'] }])
  })

  it('reports the carrier a value came from, not the one it is placed in', () => {
    expect(carriers('path-as-body')).toEqual([{ carrier: 'body', origins: ['path'] }])
    expect(carriers('unrelated')).toEqual([{ carrier: 'body', origins: [] }])
  })

  it('traces logical operands, spreads, members and wrapping calls', () => {
    expect(carriers('logical')).toEqual([
      { carrier: 'query', origins: ['query'] },
      { carrier: 'body', origins: ['path', 'query'] },
      { carrier: 'header', origins: ['header'] },
    ])
    expect(carriers('spreads')).toEqual([{ carrier: 'body', origins: ['path', 'query'] }])
    expect(carriers('destructured')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(carriers('members')).toEqual([
      { carrier: 'header', origins: ['header'] },
      { carrier: 'query', origins: ['query'] },
      { carrier: 'path', origins: ['header'] },
    ])
    expect(carriers('element')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(carriers('wrapped')).toEqual([{ carrier: 'body', origins: ['path'] }])
    expect(carriers('catching')).toEqual([{ carrier: 'body', origins: ['body'] }])
  })

  it('handles pattern parameters, nested closures, odd writes and cycles', () => {
    expect(carriers('nested-helper')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(carriers('destructured-param')).toEqual([{ carrier: 'query', origins: [] }])
    expect(carriers('repeated-identifier')).toEqual([{ carrier: 'body', origins: ['body'] }])
    expect(carriers('non-identifier-write')).toEqual([{ carrier: 'query', origins: [] }])
    expect(carriers('bare-let')).toEqual([{ carrier: 'path', origins: ['path'] }])
    expect(carriers('cyclic')).toEqual([{ carrier: 'query', origins: [] }])
    expect(carriers('undefined-value')).toEqual([
      { carrier: 'query', origins: [] },
      { carrier: 'body', origins: [] },
    ])
    expect(carriers('input-keys')).toEqual([{ carrier: 'query', origins: ['query'] }])
  })

  it('binds helper parameters to call-site origins and reports unbound ones', () => {
    expect(carriers('bound-body')).toEqual([{ carrier: 'body', origins: ['body'] }])
    // An omitted optional argument is the default, not an unknown value.
    expect(carriers('no-argument')).toEqual([{ carrier: 'body', origins: [] }])
    expect(facts['GET:/api/extra']!.validatorSites[0]!.carriers[0]).toMatchObject({
      origins: [],
      unresolved: 'parameter `extra` has no call-site binding',
    })
  })

  it('carries the origins of a followed helper return value', () => {
    expect(carriers('body-helper')).toEqual([{ carrier: 'body', origins: ['body'] }])
    expect(carriers('pick')).toEqual([{ carrier: 'query', origins: ['query'] }])
    expect(carriers('constant')).toEqual([{ carrier: 'body', origins: [] }])
    expect(carriers('cycle')).toEqual([{ carrier: 'body', origins: ['query'] }])
    expect(carriers('repeated')).toEqual([
      { carrier: 'query', origins: ['query'] },
      { carrier: 'path', origins: ['path'] },
    ])
  })
})
