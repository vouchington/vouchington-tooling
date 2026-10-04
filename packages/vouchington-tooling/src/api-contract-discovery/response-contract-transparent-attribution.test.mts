import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildVirtualProgramMatrix,
  COLD_VIRTUAL_PROGRAM_TIMEOUT_MS,
} from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts, type AmbiguousAttributionFact } from './index.mts'

const sources = {
  'dynamic-error': `
    declare const app: any
    type ErrorBody = { error: string }
    function sendError(ctx: any, message: string, status: number) {
      ctx.setStatus(status)
      ctx.json(({ error: message }))
      ctx.json({ error: message } as ErrorBody)
      ctx.json({ error: message } satisfies ErrorBody)
      ctx.json(<ErrorBody>{ error: message })
      ctx.json(({ error: message })!)
    }
    app.route('/api/v1/items').post((ctx: any) => sendError(ctx, 'bad', 409))
    app.route('/api/v1/widgets').post((ctx: any) => sendError(ctx, 'bad', 409))
  `,
  'wrapped-aliases': `
    declare const app: any
    function send(ctx: any) { ctx.json({ shared: true }) }
    type Handler = typeof send
    const parenthesized = (send)
    const asserted = send as Handler
    const typeAsserted = <Handler>send
    const satisfied = send satisfies Handler
    const nonNull = send!
    app.route('/api/v1/direct').post(send)
    app.route('/api/v1/parenthesized').post(parenthesized)
    app.route('/api/v1/asserted').post(asserted)
    app.route('/api/v1/type-asserted').post(typeAsserted)
    app.route('/api/v1/satisfied').post(satisfied)
    app.route('/api/v1/non-null').post(nonNull)
  `,
} as const

let matrix: ReturnType<typeof buildVirtualProgramMatrix<keyof typeof sources>>

function discover(sourceId: keyof typeof sources, facts?: AmbiguousAttributionFact[]) {
  const sourceFile = matrix.sourceFile(sourceId)
  return discoverApiResponseContracts(
    matrix.program,
    [sourceFile],
    undefined,
    facts ? { onAmbiguousAttribution: (fact) => facts.push(fact) } : undefined,
  )
}

describe('transparent response-attribution expressions', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('recognizes dynamic error objects through transparent expression wrappers', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('dynamic-error', facts)
    expect(facts).toEqual([])
  })

  it('unwraps transparent wrappers around immutable local handler aliases', () => {
    const facts: AmbiguousAttributionFact[] = []
    const normal = discover('wrapped-aliases')
    const withFacts = discover('wrapped-aliases', facts)
    expect(withFacts).toEqual(normal)
    expect(facts[0]?.routes).toEqual([
      'POST:/api/v1/asserted',
      'POST:/api/v1/direct',
      'POST:/api/v1/non-null',
      'POST:/api/v1/parenthesized',
      'POST:/api/v1/satisfied',
      'POST:/api/v1/type-asserted',
    ])
  })
})
