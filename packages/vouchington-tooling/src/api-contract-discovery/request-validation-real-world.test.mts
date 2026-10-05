import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  librarySources,
  type ModuleProgram,
} from './request-validation.test-helpers.mts'

const files = {
  ...librarySources,
  'lib/context.ts': `
    export interface Ctx {
      request: { json(limit?: string): Promise<unknown>; buffer(limit?: string): Promise<Buffer> }
      assert(value: unknown, status: number, message: string): void
      params: Record<string, string>
      query: Record<string, unknown>
    }
  `,
  'lib/paths.ts': `export const ITEMS_PATH = '/api/items'`,
  'lib/body.ts': `
    import type { Ctx } from './context'
    export async function parseJsonBody<T = unknown>(ctx: Ctx, maxSize = '1mb'): Promise<T> {
      return (await ctx.request.json(maxSize)) as T
    }
    export async function readOptionalBody(ctx: Ctx, limit: string): Promise<unknown | undefined> {
      const raw = await ctx.request.buffer(limit)
      if (raw.length === 0) return undefined
      try {
        return JSON.parse(raw.toString('utf8')) as unknown
      } catch {
        ctx.assert(false, 400, 'invalid')
        return undefined
      }
    }
  `,
  'routes/real.ts': `
    import { validateInput } from '../lib/validation'
    import { createThingHandler } from '../lib/factory'
    import { parseJsonBody, readOptionalBody } from '../lib/body'
    import { ITEMS_PATH } from '../lib/paths'
    // @ts-expect-error the module does not resolve, so the symbol has no declarations
    import { missingReport } from './nowhere'
    import type { Ctx } from '../lib/context'
    declare const app: any
    declare const flag: boolean
    declare const dynamic: string
    app.route('/api/typed-body').post(async (ctx: Ctx) => {
      const body = await parseJsonBody<{ name: string }>(ctx)
      validateInput(ctx, 'POST:/api/typed-body', { body })
    })
    app.route('/api/optional-body').post(async (ctx: Ctx) => {
      await parseOptional(ctx)
    })
    async function parseOptional(ctx: Ctx) {
      const body = await readOptionalBody(ctx, '20kb')
      if (body === undefined) return undefined
      validateInput(ctx, 'POST:/api/optional-body', { body })
    }
    app.route('/api/unresolved-callee').post(async (ctx: Ctx) => {
      missingReport(new Error('x'))
      validateInput(ctx, 'POST:/api/unresolved-callee', { path: ctx.params })
    })

    function normalize(value: unknown): unknown {
      return typeof value === 'string' ? value.trim() : value
    }
    app.route('/api/self-feeding').post(async (ctx: Ctx) => {
      const body = (await ctx.request.json()) as { force?: unknown }
      body.force = normalize(body.force)
      validateInput(ctx, 'POST:/api/self-feeding', { body })
    })
    function wrap(value: unknown): unknown { return unwrap(value) }
    function unwrap(value: unknown): unknown { return flag ? wrap(wrap(value)) : value }
    app.route('/api/mutual-recursion').post(async (ctx: Ctx) => {
      const body = (await ctx.request.json()) as { force?: unknown }
      body.force = wrap(body.force)
      validateInput(ctx, 'POST:/api/mutual-recursion', { body })
    })

    function page(query: Record<string, unknown>, bounds?: number, size = 10) {
      return { limit: Number(query.limit) + (bounds ?? size) }
    }
    app.route('/api/omitted-optional').get(async (ctx: Ctx) => {
      validateInput(ctx, 'GET:/api/omitted-optional', { query: page(ctx.query) })
    })
    function required(query: Record<string, unknown>, bounds: number) { return [query, bounds] }
    app.route('/api/omitted-required').get(async (ctx: Ctx) => {
      // @ts-expect-error the required argument is missing on purpose
      validateInput(ctx, 'GET:/api/omitted-required', { query: required(ctx.query) })
    })

    const direct = createThingHandler({ operation: 'POST:/api/const-factory' })
    const guarded = createThingHandler({ operation: 'POST:/api/const-factory-guarded' })
    app.route('/api/const-factory').post(async (ctx: Ctx) => {
      await direct(ctx)
    })
    app.route('/api/const-factory-guarded').post(async (ctx: Ctx) => {
      if (flag) await guarded(ctx)
    })
    app.route('/api/const-factory-both').post(async (ctx: Ctx) => {
      if (flag) await direct(ctx)
      await direct(ctx)
    })
    app.route('/api/discarded-factory').post(async (ctx: Ctx) => {
      createThingHandler({ operation: 'POST:/api/discarded-factory' })
      void ctx
    })

    const listRoute = \`GET:\${ITEMS_PATH}\`
    const nested = \`\${listRoute}/\${'x'}\`
    app.route('/api/template-key').get(async (ctx: Ctx) => {
      validateInput(ctx, listRoute, {})
      validateInput(ctx, nested, {})
      validateInput(ctx, \`GET:\${dynamic}\`, {})
      validateInput(ctx, \`GET:\${ITEMS_PATH}/\${dynamic}\`, {})
    })
    function checkAt(ctx: Ctx, path: string) { validateInput(ctx, \`GET:\${path}\`, {}) }
    app.route('/api/template-param').get(async (ctx: Ctx) => { checkAt(ctx, '/api/param') })
    function makeHandler() { return (c: Ctx) => c }
    const plain = makeHandler()
    app.route('/api/plain-const').post(async (ctx: Ctx) => { plain(ctx) })
  `,
}

let facts: ReturnType<typeof discover>
let built: ModuleProgram
const route = (id: string, method = 'POST') => facts[`${method}:/api/${id}`]!
const carriers = (id: string, method = 'POST') => route(id, method).validatorSites[0]!.carriers

describe('request validation real-world shapes', () => {
  beforeAll(() => {
    built = buildModuleProgram(files)
    facts = discover(built, [
      'routes/real.ts',
      'lib/validation.ts',
      'lib/body.ts',
      'lib/factory.ts',
    ])
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('follows generic body helpers with a cast and a defaulted parameter', () => {
    expect(carriers('typed-body')).toEqual([{ carrier: 'body', origins: ['body'] }])
  })

  it('follows an optional body reader called through a nested helper', () => {
    expect(carriers('optional-body')).toEqual([{ carrier: 'body', origins: ['body'] }])
  })

  it('does not follow a helper declared outside the source files', () => {
    const narrow = discover(built, ['routes/real.ts', 'lib/validation.ts'])
    expect(narrow['POST:/api/typed-body']!.validatorSites[0]!.carriers).toEqual([
      { carrier: 'body', origins: [] },
    ])
  })

  it('treats a callee symbol without declarations as not configured', () => {
    expect(route('unresolved-callee').validatorSites).toMatchObject([
      { carriers: [{ carrier: 'path', origins: ['path'] }] },
    ])
  })

  it('terminates when a value feeds the call that rewrites it', () => {
    expect(carriers('self-feeding')).toEqual([{ carrier: 'body', origins: ['body'] }])
    expect(carriers('mutual-recursion')).toEqual([{ carrier: 'body', origins: ['body'] }])
  })

  it('treats an omitted optional or defaulted argument as resolved', () => {
    const [carrier] = carriers('omitted-optional', 'GET')
    expect(carrier).toEqual({ carrier: 'query', origins: ['query'] })
    expect(carriers('omitted-required', 'GET')[0]).toMatchObject({
      unresolved: 'parameter `bounds` has no call-site binding',
    })
  })

  it('reports a factory site when a handler calls a const built by a factory', () => {
    expect(route('const-factory').factorySites).toEqual([
      {
        exportName: 'createThingHandler',
        source: '/virtual/routes/real.ts:57',
        operation: 'POST:/api/const-factory',
        carriers: ['path', 'body'],
        conditional: false,
      },
    ])
    expect(route('const-factory-guarded').factorySites).toMatchObject([
      { operation: 'POST:/api/const-factory-guarded', conditional: true },
    ])
    expect(route('const-factory-both').factorySites).toMatchObject([
      { operation: 'POST:/api/const-factory', conditional: false },
    ])
    expect(route('discarded-factory').factorySites).toEqual([])
    expect(route('plain-const').factorySites).toEqual([])
  })

  it('folds template literals whose substitutions are all static', () => {
    const operations = route('template-key', 'GET').validatorSites.map((site) => site.operation)
    expect(operations).toEqual(['GET:/api/items', 'GET:/api/items/x', null, null])
    expect(route('template-key', 'GET').validatorSites[2]).toMatchObject({
      unresolvedReason: 'operation key ``GET:${dynamic}`` is not statically resolvable',
    })
    expect(route('template-param', 'GET').validatorSites[0]!.operation).toBe('GET:/api/param')
  })
})
