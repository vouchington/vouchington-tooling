import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  librarySources,
  type ModuleProgram,
} from './request-validation.test-helpers.mts'

const KEY = "'GET:/api/items'"
const validate = `validateInput(ctx, ${KEY}, {})`

const handlers: Record<string, string> = {
  helper: 'readLimit(ctx)',
  'query-forms': `ctx.query.limit
    ctx.query['page']
    ctx.query[dynamic]
    ctx.query[LITERAL_KEY]`,
  destructured: `const { a, b: renamed, 'c': quoted, ...rest } = ctx.query
    void [a, renamed, quoted, rest]`,
  params: `const { id } = ctx.params
    ctx.params.slug
    void id`,
  bodies: `await ctx.request.json()
    await ctx.request.buffer()`,
  headers: `ctx.get('x-a')
    ctx.get(dynamic)
    ctx.headers['x-b']
    ctx.headers.accept`,
  aliases: `const q = ctx.query
    q.limit
    const { query } = ctx
    query.page
    const { params } = ctx
    params.id
    const { ...everything } = ctx
    everything.query.ignored`,
  bound: 'readKey(ctx.query)',
  'computed-keys': `const { [dynamic]: value } = ctx.query
    const { [dynamic]: member } = ctx
    const [first] = [ctx.query]
    void [value, member.x, first.limit]
    ctx.header.accept`,
  request: `ctx.request.query.cursor
    const { request } = ctx
    request.headers.accept`,
  whole: `consume(ctx.query)
    const copy = { ...ctx.params }
    const alias = ctx.query
    consume({ alias })
    consume((alias as any)!)
    const wrapped = (ctx.query as any)!.limit
    void [copy, wrapped]
    return ctx.headers`,
  'in-validator': `validateInput(ctx, ${KEY}, { query: ctx.query.limit, body: await ctx.request.json() })`,
  'validator-only': validate,
  'unrelated-object': 'unrelated.query.limit; unrelated.request.json(); other.get(1)',
  dead: 'if (false) { ctx.query.hidden }',
  'callback-skipped': 'items.map(() => ctx.query.skipped)',
  'throw-only': 'ctx.throw(405)',
}

const files = {
  ...librarySources,
  'routes/reads.ts': `
    import { validateInput } from '../lib/validation'
    declare const app: any
    declare const dynamic: string
    declare const unrelated: any
    declare const other: any
    declare const items: number[]
    const LITERAL_KEY = 'fixed'
    declare function consume(value: unknown): void
    function readLimit(ctx: any) { return ctx.query.limit }
    function readKey(query: any) { return query.cursor }
    ${Object.entries(handlers)
      .map(([id, body]) => `app.route('/api/${id}').get(async (ctx: any) => { ${body} })`)
      .join('\n')}
    declare function apiOpenApiNoContent(key: string, status: number): void
    app.route('/api/no-content').get(() => { apiOpenApiNoContent('GET:/api/no-content', 204) })
  `,
}

let facts: ReturnType<typeof discover>
const reads = (route: string) =>
  facts[`GET:/api/${route}`]!.carrierReads.map(({ carrier, key, access }) => [carrier, key, access])

describe('request validation carrier reads', () => {
  beforeAll(() => {
    const built: ModuleProgram = buildModuleProgram(files)
    facts = discover(built, ['routes/reads.ts', 'lib/validation.ts'])
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('reports a query read in a helper with its key', () => {
    expect(reads('helper')).toEqual([['query', 'limit', 'key']])
    expect(facts['GET:/api/helper']!.carrierReads[0]!.source).toBe('/virtual/routes/reads.ts:10')
  })

  it('reports query, params and destructured reads with static keys or null', () => {
    expect(reads('query-forms')).toEqual([
      ['query', 'limit', 'key'],
      ['query', 'page', 'key'],
      ['query', null, 'computed'],
      ['query', 'fixed', 'key'],
    ])
    expect(reads('destructured')).toEqual([
      ['query', 'a', 'key'],
      ['query', 'b', 'key'],
      ['query', 'c', 'key'],
      ['query', null, 'whole'],
    ])
    expect(reads('params')).toEqual([
      ['path', 'id', 'key'],
      ['path', 'slug', 'key'],
    ])
  })

  it('reports body and header reads', () => {
    expect(reads('bodies')).toEqual([
      ['body', null, 'whole'],
      ['body', null, 'whole'],
    ])
    expect(reads('headers')).toEqual([
      ['header', 'x-a', 'key'],
      ['header', null, 'computed'],
      ['header', 'x-b', 'key'],
      ['header', 'accept', 'key'],
    ])
  })

  it('reports computed destructuring and singular header members', () => {
    expect(reads('computed-keys')).toEqual([
      ['query', null, 'computed'],
      ['query', null, 'whole'],
      ['header', 'accept', 'key'],
    ])
  })

  it('reports whole-carrier value uses with a null key', () => {
    expect(reads('whole')).toEqual([
      ['query', null, 'whole'],
      ['path', null, 'whole'],
      ['query', null, 'whole'],
      ['query', null, 'whole'],
      ['query', 'limit', 'key'],
      ['header', null, 'whole'],
    ])
  })

  it('follows const aliases, destructured members and bound parameters', () => {
    expect(reads('aliases')).toEqual([
      ['query', 'limit', 'key'],
      ['query', 'page', 'key'],
      ['path', 'id', 'key'],
    ])
    expect(reads('bound')).toEqual([
      ['query', 'cursor', 'key'],
      ['query', null, 'whole'],
    ])
    expect(reads('request')).toEqual([
      ['query', 'cursor', 'key'],
      ['header', 'accept', 'key'],
    ])
  })

  it('skips validator internals, validator input shaping, and unrelated or dead reads', () => {
    for (const route of [
      'in-validator',
      'validator-only',
      'unrelated-object',
      'dead',
      'callback-skipped',
      'throw-only',
      'no-content',
    ])
      expect(reads(route)).toEqual([])
  })

  it('takes the route kind from route discovery', () => {
    expect(facts['GET:/api/throw-only']!.kind).toBe('error-only')
    expect(facts['GET:/api/no-content']!.kind).toBe('fixed-no-content')
    expect(facts['GET:/api/helper']).toMatchObject({
      kind: 'ordinary',
      source: '/virtual/routes/reads.ts:12',
    })
  })
})
