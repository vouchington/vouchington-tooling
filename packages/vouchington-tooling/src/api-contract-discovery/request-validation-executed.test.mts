import { beforeAll, describe, expect, it } from 'vitest'

import { COLD_VIRTUAL_PROGRAM_TIMEOUT_MS } from './test-setup.test-helpers.mts'
import {
  buildModuleProgram,
  discover,
  librarySources,
  type ModuleProgram,
} from './request-validation.test-helpers.mts'
import type { ExecutedCallbackConfig } from './request-validation-types.mts'

const validate = "validateInput(ctx, 'GET:/api/items', { query: ctx.query })"

const handlers: Record<string, string> = {
  inline: `await admitWork({
      beforeCapacity: async () => { ${validate} },
      execute: async function () { ctx.query.limit },
      other: () => { validateInput(ctx, 'GET:/api/other', {}) },
    })`,
  method: `await admitWork({ async beforeCapacity() { ${validate} } })`,
  identifier: `const callback = async () => { ${validate} }
    await admitWork({ beforeCapacity: callback })`,
  conditional: `if (flag) await admitWork({ beforeCapacity: async () => { ${validate} } })`,
  'conditional-inside': `await admitWork({ beforeCapacity: async () => { if (flag) { ${validate} } } })`,
  'not-literal': `await admitWork(options)
    await admitWork()
    await admitWork({ ...options })
    await admitWork({ [key]: () => { ${validate} } })`,
  quoted: `await admitWork({ 'beforeCapacity': async () => { ${validate} }, 'other': () => { ${validate} } })`,
  // The configured implementation runs `execute` under a condition; it is never entered.
  gated: `await admitWork({ execute: async () => { ${validate} } })`,
  unconfigured: `await unconfigured({ beforeCapacity: async () => { ${validate} } })`,
  local: `await local({ beforeCapacity: async () => { ${validate} } })`,
}

const files = {
  ...librarySources,
  'lib/admit.ts': `
    export async function admitWork(options?: any): Promise<void> {
      await options?.beforeCapacity?.()
      if (options?.gate) await options?.execute?.()
    }
    export async function unconfigured(options?: any): Promise<void> {
      await options?.beforeCapacity?.()
    }
  `,
  'routes/executed.ts': `
    import { validateInput } from '../lib/validation'
    import { admitWork, unconfigured } from '../lib/admit'
    declare const app: any
    declare const flag: boolean
    declare const options: any
    declare const key: string
    async function local(options: any) { await options.beforeCapacity() }
    ${Object.entries(handlers)
      .map(([id, body]) => `app.route('/api/${id}').get(async (ctx: any) => { ${body} })`)
      .join('\n')}
  `,
}
const executedCallbacks: readonly ExecutedCallbackConfig[] = [
  {
    module: 'lib/admit.ts',
    exportName: 'admitWork',
    argument: 0,
    properties: ['beforeCapacity', 'execute'],
  },
]

let facts: ReturnType<typeof discover>
const sites = (route: string) => facts[`GET:/api/${route}`]!.validatorSites

describe('request validation executed callbacks', () => {
  beforeAll(() => {
    const built: ModuleProgram = buildModuleProgram(files)
    facts = discover(built, ['routes/executed.ts', 'lib/validation.ts', 'lib/admit.ts'], {
      executedCallbacks,
    })
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('walks listed inline callbacks of a configured call as part of the handler', () => {
    expect(sites('inline')).toMatchObject([{ operation: 'GET:/api/items', conditional: false }])
    expect(facts['GET:/api/inline']!.carrierReads).toMatchObject([
      { carrier: 'query', key: 'limit' },
    ])
    expect(sites('method')).toMatchObject([{ conditional: false }])
  })

  it('matches quoted property names and ignores how the host invokes the callback', () => {
    expect(sites('quoted')).toMatchObject([{ operation: 'GET:/api/items', conditional: false }])
    expect(sites('gated')).toMatchObject([{ operation: 'GET:/api/items', conditional: false }])
  })

  it('applies conditions from the call and from inside the callback', () => {
    expect(sites('conditional')).toMatchObject([{ conditional: true }])
    expect(sites('conditional-inside')).toMatchObject([{ conditional: true }])
  })

  it('does not follow identifiers, unconfigured callees or non-literal arguments', () => {
    for (const route of ['identifier', 'not-literal', 'unconfigured', 'local'])
      expect(sites(route)).toEqual([])
  })

  it('walks nothing when no callbacks are configured', () => {
    const built = buildModuleProgram(files)
    const without = discover(built, ['routes/executed.ts', 'lib/validation.ts', 'lib/admit.ts'])
    expect(without['GET:/api/inline']!.validatorSites).toEqual([])
    expect(without['GET:/api/inline']!.carrierReads).toEqual([])
  })
})
