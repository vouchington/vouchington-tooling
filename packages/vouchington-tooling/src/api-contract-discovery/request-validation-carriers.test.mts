import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  validators,
  librarySources,
  type ModuleProgram,
} from './request-validation.test-helpers.mts'

const preamble = `
  import { validateInput, validatePage } from '../lib/validation'
  import { createThingHandler } from '../lib/factory'
  declare const app: any
  declare const unrelated: any
  declare const flag: boolean
  declare function makeOptions(): any
  declare const maybe: string | undefined
  const operation = 'POST:/api/shorthand'
`
const KEY = "'GET:/api/items'"
const handler = (body: string) => `${preamble}
  app.route('/api/items').get(async (ctx: any) => { ${body} })`

const files = {
  ...librarySources,
  'routes/input.ts': handler(`validateInput(ctx, ${KEY}, {
    path: ctx.params,
    query: ctx.query,
    body: await ctx.request.json(),
    header: ctx.get('x-key'),
    extra: 1,
    method() { return 1 },
  })`),
  'routes/input-const.ts': handler(`const input = { query: ctx.query }
    validateInput(ctx, ${KEY}, input)`),
  'routes/non-literal-input.ts': handler(`validateInput(ctx, ${KEY}, unrelated)
    validateInput(ctx, ${KEY})`),
  'routes/fixed.ts': handler(`validatePage(ctx, ${KEY})
    validatePage(ctx, ${KEY}, { path: true })
    validatePage(ctx, ${KEY}, { path: false })
    validatePage(ctx, ${KEY}, { path: flag })
    validatePage(ctx, ${KEY}, { path() { return true } })
    const options = { path: true }
    validatePage(ctx, ${KEY}, options)`),
  'routes/factory-direct.ts': `${preamble}
    app.route('/api/direct').post(createThingHandler({ operation: 'POST:/api/direct' }))
    const wrap = <T>(value: T): T => value
    app.route('/api/wrapped').post(wrap(createThingHandler({ operation: 'POST:/api/wrapped' })))
    const bound = createThingHandler({ operation: 'POST:/api/bound' })
    app.route('/api/bound').post(bound)
  `,
  'routes/factory-spread.ts': `${preamble}
    const base = { operation: 'POST:/api/spread' }
    app.route('/api/spread').post(createThingHandler({ ...base, mode: 'strict' }))
    app.route('/api/overridden').post(createThingHandler({ ...base, operation: 'POST:/api/overridden' }))
    app.route('/api/replaced').post(createThingHandler({ ...{ operation: 'POST:/api/stale' }, ...base }))
    app.route('/api/nested').post(createThingHandler({ ...{ mode: 'x' }, ...{ operation: 'POST:/api/nested' } }))
    app.route('/api/shorthand').post(createThingHandler({ operation }))
    app.route('/api/unknown').post(createThingHandler({ ...unrelated }))
    app.route('/api/missing').post(createThingHandler(unrelated))
    app.route('/api/quoted').post(createThingHandler({ 'operation': 'POST:/api/quoted' }))
    // @ts-expect-error spread cycle
    const first: any = { ...second }
    const second: any = { ...first, mode: 'x' }
    app.route('/api/cyclic').post(createThingHandler({ ...first }))
    app.route('/api/call').post(createThingHandler(makeOptions()))
    app.route('/api/absent').post(
      createThingHandler({ ...{ operation: 'POST:/api/absent' }, ...{ mode: 'x' } }),
    )
    function make(operation: string) { return createThingHandler({ operation }) }
    function loop(operation: string): any {
      if (flag) return loop(operation)
      return createThingHandler({ operation })
    }
    app.route('/api/made').post(make('POST:/api/made'))
    app.route('/api/looped').post(loop('x'))
    app.route('/api/method').post(createThingHandler({ operation: 'POST:/api/method', run() {} }))
    app.route('/api/undefined').post(createThingHandler({ operation: undefined }))
    app.route('/api/computed').post(createThingHandler({ [maybe ?? 'operation']: 'POST:/api/x' }))
  `,
}

let built: ModuleProgram
const facts = (id: string, extra: readonly string[] = ['lib/validation.ts', 'lib/factory.ts']) =>
  discover(built, [`routes/${id}.ts`, ...extra])

describe('request validation carriers', () => {
  beforeAll(() => {
    built = buildModuleProgram(files)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('reports input-object property carriers with their own origins', () => {
    const [site] = facts('input')['GET:/api/items']!.validatorSites
    expect(site).toEqual({
      exportName: 'validateInput',
      source: '/virtual/routes/input.ts:11',
      operation: 'GET:/api/items',
      carriers: [
        { carrier: 'path', origins: ['path'] },
        { carrier: 'query', origins: ['query'] },
        { carrier: 'body', origins: ['body'] },
        { carrier: 'header', origins: ['header'] },
      ],
      conditional: false,
    })
  })

  it('resolves an input object through a const', () => {
    expect(facts('input-const')['GET:/api/items']!.validatorSites[0]?.carriers).toEqual([
      { carrier: 'query', origins: ['query'] },
    ])
  })

  it('reports no carriers when the input is not an object literal', () => {
    expect(
      facts('non-literal-input')['GET:/api/items']!.validatorSites.map((site) => site.carriers),
    ).toEqual([[], []])
  })

  it('reports fixed carriers plus option carriers only when the option is literally true', () => {
    const sites = facts('fixed')['GET:/api/items']!.validatorSites
    const carriers = sites.map((site) => site.carriers.map((item) => item.carrier))
    expect(carriers).toEqual([
      ['query'],
      ['query', 'path'],
      ['query'],
      ['query'],
      ['query'],
      ['query', 'path'],
    ])
    expect(sites[0]?.carriers).toEqual([{ carrier: 'query', origins: ['query'] }])
  })

  it('reports fixed carriers when no option carriers are configured', () => {
    const plain = [{ ...validators[1]!, carriers: { kind: 'fixed', carriers: ['query'] } } as const]
    const result = discover(built, ['routes/fixed.ts', 'lib/validation.ts'], { validators: plain })
    for (const site of result['GET:/api/items']!.validatorSites)
      expect(site.carriers.map((item) => item.carrier)).toEqual(['query'])
  })

  it('reports factory carriers and operation keys without entering the factory', () => {
    const result = facts('factory-direct')
    const operations = (route: string) => result[route]!.factorySites.map((site) => site.operation)
    expect(result['POST:/api/direct']).toMatchObject({
      factorySites: [
        {
          exportName: 'createThingHandler',
          operation: 'POST:/api/direct',
          carriers: ['path', 'body'],
        },
      ],
      validatorSites: [],
      carrierReads: [],
    })
    expect(operations('POST:/api/wrapped')).toEqual(['POST:/api/wrapped'])
    expect(operations('POST:/api/bound')).toEqual(['POST:/api/bound'])
  })

  it('resolves the option property through spread const objects', () => {
    const result = facts('factory-spread')
    const operation = (route: string) => result[route]!.factorySites[0]
    expect(operation('POST:/api/spread')?.operation).toBe('POST:/api/spread')
    expect(operation('POST:/api/overridden')?.operation).toBe('POST:/api/overridden')
    expect(operation('POST:/api/replaced')?.operation).toBe('POST:/api/spread')
    expect(operation('POST:/api/nested')?.operation).toBe('POST:/api/nested')
    expect(operation('POST:/api/shorthand')?.operation).toBe('POST:/api/shorthand')
    expect(operation('POST:/api/quoted')?.operation).toBe('POST:/api/quoted')
    expect(operation('POST:/api/made')?.operation).toBe('POST:/api/made')
    expect(operation('POST:/api/method')?.operation).toBe('POST:/api/method')
    expect(operation('POST:/api/absent')?.operation).toBe('POST:/api/absent')
    for (const route of ['unknown', 'missing', 'computed', 'cyclic', 'call', 'undefined'])
      expect(operation(`POST:/api/${route}`)).toMatchObject({
        operation: null,
        unresolvedReason: 'option "operation" is not statically resolvable',
      })
  })
})
