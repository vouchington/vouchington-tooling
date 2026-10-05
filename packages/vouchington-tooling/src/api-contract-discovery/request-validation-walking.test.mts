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
  import { runValidation } from '../lib/helper'
  declare const app: any
  declare const flag: boolean
  declare const maybe: string | undefined
  declare const items: number[]
`
const KEY = "'GET:/api/items'"
const validate = `validateInput(ctx, ${KEY}, {})`

const conditionalHandlers = {
  straight: validate,
  'if-branch': `if (flag) { ${validate} }`,
  'else-branch': `if (flag) { ctx.status = 1 } else { ${validate} }`,
  'if-condition': `if (${validate}) { ctx.status = 1 }`,
  ternary: `flag ? ${validate} : undefined`,
  'ternary-condition': `${validate} ? 1 : 2`,
  and: `flag && ${validate}`,
  'and-left': `${validate} && flag`,
  or: `flag || ${validate}`,
  nullish: `maybe ?? ${validate}`,
  switch: `switch (maybe) { case 'a': ${validate}; break; default: ${validate} }`,
  catch: `try { ctx.status = 1 } catch { ${validate} }`,
  finally: `try { ctx.status = 1 } finally { ${validate} }`,
  loop: `for (const item of items) { ${validate} }`,
  'while-loop': `while (flag) { ${validate} }`,
  'early-return': `if (flag) return; ${validate}`,
  try: `try { ${validate} } catch { ctx.status = 1 }`,
  'helper-straight': 'check(ctx)',
  'helper-if': 'if (flag) check(ctx)',
  'helper-nested': 'outer(ctx)',
  'helper-both': `check(ctx); if (flag) check(ctx)`,
  iife: `;(() => { ${validate} })()`,
  'iife-if': `if (flag) (() => { ${validate} })()`,
  'callback-run': `run(() => { ${validate} })`,
  'callback-if': `if (flag) run(() => { ${validate} })`,
  'callback-ignored': `ignore(() => { ${validate} })`,
  'callback-builtin': `items.forEach(() => { ${validate} })`,
}

const walkingHandlers = {
  dead: `const unused = () => { ${validate} }
    void unused`,
  'dead-branch': `if (false) { ${validate} }`,
  'after-return': `return; ${validate}`,
  'const-helper': 'arrowHelper(ctx)',
  recursive: 'recurse(ctx, 0)',
  mutual: 'ping(ctx)',
  'two-keys': `checkKey(ctx, 'GET:/api/one'); checkKey(ctx, 'GET:/api/two')`,
  'cross-file': `runValidation(ctx, ${KEY})`,
  'method-not-followed': `const holder = { run() { ${validate} } }; holder.run(); holder['run']()`,
  'let-helper': 'letHelper(ctx)',
  ambient: 'ambient(ctx)',
  'default-binding': 'defaulted(ctx)',
}

const handlersSource = (handlers: Record<string, string>) =>
  Object.entries(handlers)
    .map(([id, body]) => `app.route('/api/${id}').get(async (ctx: any) => { ${body} })`)
    .join('\n')

const files = {
  ...librarySources,
  'lib/helper.ts': `
    import { validateInput } from './validation'
    export function runValidation(ctx: any, operation: string) {
      validateInput(ctx, operation, { query: ctx.query })
    }
  `,
  'routes/conditional.ts': `${preamble}
    function check(ctx: any) { ${validate} }
    function inner(ctx: any) { ${validate} }
    function outer(ctx: any) { if (flag) inner(ctx) }
    function run(callback: () => void) { callback() }
    function ignore(callback: () => void) { void callback }
    ${handlersSource(conditionalHandlers)}
  `,
  'routes/walking.ts': `${preamble}
    declare const ambient: (ctx: any) => void
    let letHelper = (ctx: any) => { ${validate} }
    const arrowHelper = (ctx: any) => { ${validate} }
    function recurse(ctx: any, depth: number): void {
      ${validate}
      if (depth < 3) recurse(ctx, depth + 1)
    }
    function ping(ctx: any): void { ${validate}; pong(ctx) }
    function pong(ctx: any): void { ping(ctx) }
    function checkKey(ctx: any, key: string) { validateInput(ctx, key, {}) }
    function defaulted(ctx: any, key = 'GET:/api/default') { validateInput(ctx, key, {}) }
    ${handlersSource(walkingHandlers)}
    app.route('/api/items/:id').patch(async (ctx: any) => {
      validateInput(ctx, 'PATCH:/api/items/:id', { path: ctx.params })
      validateInput(ctx, 'PATCH:/api/items/:id', { body: await ctx.request.json() })
    })
    function makeHandler(operation: string) {
      return async (ctx: any) => { validateInput(ctx, operation, { query: ctx.query, header: operation }) }
    }
    app.route('/api/made').get(makeHandler('GET:/api/made'))
    app.route('/api/made-dynamic').get(makeHandler(maybe ?? 'x'))
    const named = async (ctx: any) => { ${validate} }
    app.route('/api/named').get(named)
    async function declared(ctx: any) { ${validate} }
    app.route('/api/declared').get(declared)
    app.route('/api/chained').get(async (ctx: any) => { ${validate} }, async (ctx: any) => { checkKey(ctx, 'GET:/api/chained') })
  `,
}

let built: ModuleProgram
const run = (id: string, libs: readonly string[]) =>
  discover(built, [`routes/${id}.ts`, 'lib/validation.ts', ...libs])
let conditionalFacts: ReturnType<typeof run>
const conditionals = (id: string) =>
  conditionalFacts[`GET:/api/${id}`]!.validatorSites.map((site) => site.conditional)

describe('request validation conditional sites', () => {
  beforeAll(() => {
    built = buildModuleProgram(files)
    conditionalFacts = run('conditional', [])
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('reports straight-line and condition-position calls as unconditional', () => {
    for (const id of ['straight', 'if-condition', 'ternary-condition', 'and-left', 'try'])
      expect(conditionals(id)).toEqual([false])
  })

  it('reports if, else, ternary, short-circuit, switch and catch calls as conditional', () => {
    for (const id of [
      'if-branch',
      'else-branch',
      'ternary',
      'and',
      'or',
      'nullish',
      'catch',
      'finally',
      'loop',
      'while-loop',
    ])
      expect(conditionals(id)).toEqual([true])
    expect(conditionals('switch')).toEqual([true])
    expect(conditionals('early-return')).toEqual([false])
  })

  it('propagates conditions through followed helpers and callbacks', () => {
    expect(conditionals('helper-straight')).toEqual([false])
    expect(conditionals('helper-if')).toEqual([true])
    expect(conditionals('helper-nested')).toEqual([true])
    expect(conditionals('helper-both')).toEqual([false])
    expect(conditionals('iife')).toEqual([false])
    expect(conditionals('iife-if')).toEqual([true])
    expect(conditionals('callback-run')).toEqual([false])
    expect(conditionals('callback-if')).toEqual([true])
  })

  it('follows callbacks only when the callee runs them', () => {
    expect(conditionals('callback-ignored')).toEqual([])
    expect(conditionals('callback-builtin')).toEqual([])
  })
})

describe('request validation walking', () => {
  const facts = () => run('walking', ['lib/helper.ts'])
  const sitesOf = (route: string) => facts()[`GET:/api/${route}`]!.validatorSites

  it('contributes nothing from dead helpers or statically dead code', () => {
    for (const id of [
      'dead',
      'dead-branch',
      'after-return',
      'method-not-followed',
      'let-helper',
      'ambient',
    ])
      expect(sitesOf(id)).toEqual([])
  })

  it('follows const function helpers and terminates on recursion', () => {
    expect(sitesOf('const-helper')).toHaveLength(1)
    expect(sitesOf('recursive')).toHaveLength(1)
    expect(sitesOf('mutual')).toHaveLength(1)
  })

  it('reports each call of a helper with its own operation, in source order', () => {
    expect(sitesOf('two-keys').map((site) => site.operation)).toEqual([
      'GET:/api/one',
      'GET:/api/two',
    ])
  })

  it('does not bind a parameter that only has a default value', () => {
    expect(sitesOf('default-binding').map((site) => site.operation)).toEqual([null])
  })

  it('reports multiple validator sites on one route in source order', () => {
    const sites = facts()['PATCH:/api/items/:id']!.validatorSites
    expect(sites.map((site) => site.carriers.map((item) => item.carrier))).toEqual([
      ['path'],
      ['body'],
    ])
  })

  it('follows helpers in other source files only when they are provided', () => {
    expect(sitesOf('cross-file')).toMatchObject([
      { operation: 'GET:/api/items', carriers: [{ carrier: 'query', origins: ['query'] }] },
    ])
    expect(
      discover(built, ['routes/walking.ts', 'lib/validation.ts'])['GET:/api/cross-file']!
        .validatorSites,
    ).toEqual([])
  })

  it('binds factory parameters of the handler returned for the route', () => {
    expect(sitesOf('made')).toMatchObject([{ operation: 'GET:/api/made' }])
    expect(sitesOf('made-dynamic')).toMatchObject([{ operation: null }])
    expect(sitesOf('named')).toHaveLength(1)
    expect(sitesOf('declared')).toHaveLength(1)
  })

  it('walks every handler registered for the route', () => {
    expect(sitesOf('chained').map((site) => site.operation)).toEqual([
      'GET:/api/items',
      'GET:/api/chained',
    ])
  })
})
