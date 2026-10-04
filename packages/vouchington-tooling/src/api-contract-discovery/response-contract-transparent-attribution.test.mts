import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ts from '../contract-schema/typescript-api.mts'
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
  'wrapped-route-arguments': `
    declare const app: any
    function send(ctx: any) { ctx.json({ shared: true }) }
    type Handler = typeof send
    app.route('/api/v1/direct').post(send)
    app.route('/api/v1/parenthesized').post((send))
    app.route('/api/v1/asserted').post(send as Handler)
    app.route('/api/v1/type-asserted').post(<Handler>send)
    app.route('/api/v1/satisfied').post(send satisfies Handler)
    app.route('/api/v1/non-null').post(send!)
  `,
  'property-methods': `
    declare const app: any
    const handlers = { send(ctx: any) { ctx.json({ object: true }) } }
    const arrowHandlers = { send: (ctx: any) => ctx.json({ arrow: true }) }
    class Controller { send(ctx: any) { ctx.response.xml('<class/>') } }
    const controller = new Controller()
    app.route('/api/v1/object-a').post(handlers.send)
    app.route('/api/v1/object-b').post(handlers.send)
    app.route('/api/v1/class-a').post(controller.send)
    app.route('/api/v1/class-b').post(controller.send)
    app.route('/api/v1/arrow-a').post(arrowHandlers.send)
    app.route('/api/v1/arrow-b').post(arrowHandlers.send)
  `,
  'overridden-status': `
    declare const app: any
    function send(ctx: any, status: number) {
      ctx.setStatus(status)
      ctx.setStatus(200)
      ctx.json({ error: 'recovered' })
    }
    app.route('/api/v1/items').post((ctx: any) => send(ctx, 409))
    app.route('/api/v1/widgets').post((ctx: any) => send(ctx, 409))
  `,
  'missing-property-handler': `
    declare const app: any
    declare const handlers: {}
    // @ts-expect-error The unresolved property exercises the fail-closed symbol lookup.
    app.route('/api/v1/missing-a').post(handlers.missing)
    // @ts-expect-error The unresolved property exercises the fail-closed symbol lookup.
    app.route('/api/v1/missing-b').post(handlers.missing)
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

  it('unwraps transparent wrappers at route registration without changing defaults', () => {
    const facts: AmbiguousAttributionFact[] = []
    const normal = discover('wrapped-route-arguments')
    const withFacts = discover('wrapped-route-arguments', facts)
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

  it('attributes object and class property-access handlers', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('property-methods', facts)
    expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
      {
        label: 'ctx.json()',
        routes: ['POST:/api/v1/object-a', 'POST:/api/v1/object-b'],
      },
      {
        label: 'ctx.json()',
        routes: ['POST:/api/v1/arrow-a', 'POST:/api/v1/arrow-b'],
      },
      {
        label: 'ctx.response.xml()',
        routes: ['POST:/api/v1/class-a', 'POST:/api/v1/class-b'],
      },
    ])
  })

  it('uses the latest status setter when excluding dynamic error payloads', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('overridden-status', facts)
    expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
      {
        label: 'ctx.json()',
        routes: ['POST:/api/v1/items', 'POST:/api/v1/widgets'],
      },
    ])
  })

  it('ignores property handlers the type checker cannot resolve', () => {
    expect(discover('missing-property-handler')).toEqual({})
  })

  it('attributes anonymous default-exported function and expression handlers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'response-attribution-default-'))
    const functionPath = join(directory, 'function-handler.ts')
    const expressionPath = join(directory, 'expression-handler.ts')
    const routesPath = join(directory, 'routes.ts')
    try {
      await writeFile(
        functionPath,
        `export default function (ctx: any) { ctx.json({ function: true }) }`,
      )
      await writeFile(
        expressionPath,
        `export default ((ctx: any) => ctx.json({ expression: true }))`,
      )
      await writeFile(
        routesPath,
        `import sendFunction from './function-handler.js'\nimport sendExpression from './expression-handler.js'\ndeclare const app: any\napp.route('/api/v1/function-a').post(sendFunction)\napp.route('/api/v1/function-b').post(sendFunction)\napp.route('/api/v1/expression-a').post(sendExpression)\napp.route('/api/v1/expression-b').post(sendExpression)`,
      )
      const program = ts.createProgram([functionPath, expressionPath, routesPath], {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ESNext,
        strict: true,
        skipLibCheck: true,
      })
      const sourceFiles = [functionPath, expressionPath, routesPath]
        .map((filePath) => program.getSourceFile(filePath))
        .filter((source): source is ts.SourceFile => !!source)
      const facts: AmbiguousAttributionFact[] = []
      discoverApiResponseContracts(program, sourceFiles, undefined, {
        onAmbiguousAttribution: (fact) => facts.push(fact),
      })
      expect(facts.map(({ routes }) => routes)).toEqual([
        ['POST:/api/v1/function-a', 'POST:/api/v1/function-b'],
        ['POST:/api/v1/expression-a', 'POST:/api/v1/expression-b'],
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
