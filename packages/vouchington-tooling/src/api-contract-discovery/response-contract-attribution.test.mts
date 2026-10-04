import { beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ts from '../contract-schema/typescript-api.mts'
import {
  buildVirtualProgramMatrix,
  COLD_VIRTUAL_PROGRAM_TIMEOUT_MS,
} from './test-setup.test-helpers.mts'
import { implicitResponseCallLabel } from './response-contract-call-classification.mts'
import { discoverApiResponseContracts, type AmbiguousAttributionFact } from './index.mts'
import { visit } from './response-contract-route-analysis.mts'

const sources = {
  'shared-json': `
    declare const app: any
    function sendItem(ctx: any) {
      ctx.json({ id: 'one' as string })
    }
    app.route('/api/v1/items').post((ctx: any) => sendItem(ctx))
    app.route('/api/v1/widgets').post((ctx: any) => sendItem(ctx))
  `,
  'shared-reference': `
    declare const app: any
    function sendItem(ctx: any) {
      ctx.json({ id: 'one' as string })
    }
    app.route('/api/v1/items').post(sendItem)
    app.route('/api/v1/widgets').post(sendItem)
  `,
  'per-route': `
    declare const app: any
    function itemBody() { return { id: 'one' as string } }
    app.route('/api/v1/items').post((ctx: any) => ctx.json(itemBody()))
    app.route('/api/v1/widgets').post((ctx: any) => ctx.json(itemBody()))
  `,
  'single-route': `
    declare const app: any
    function sendItem(ctx: any) { ctx.json({ id: 'one' as string }) }
    app.route('/api/v1/items').post((ctx: any) => sendItem(ctx))
  `,
  'shared-status': `
    declare const app: any
    function markCreated(ctx: any) { ctx.setStatus(201) }
    app.route('/api/v1/items').post((ctx: any) => { markCreated(ctx); ctx.json({ id: 'one' }) })
    app.route('/api/v1/widgets').post((ctx: any) => { markCreated(ctx); ctx.json({ id: 'one' }) })
  `,
  'shared-error': `
    declare const app: any
    function sendConflict(ctx: any) { ctx.setStatus(409); ctx.json({ error: 'conflict' as string }) }
    app.route('/api/v1/items').post((ctx: any) => { sendConflict(ctx); ctx.json({ id: 'one' }) })
    app.route('/api/v1/widgets').post((ctx: any) => { sendConflict(ctx); ctx.json({ id: 'one' }) })
  `,
  'shared-dynamic-error': `
    declare const app: any, streamJsonObject: any
    function sendError(ctx: any, error: any) {
      const status = error.status
      ctx.log('sending an error')
      ctx.setStatus(status)
      ctx.json({ ...error, error: error.message })
      ctx.pipeline(streamJsonObject({ ...error, error: error.message }))
    }
    app.route('/api/v1/items').post((ctx: any) => sendError(ctx, { status: 409 }))
    app.route('/api/v1/widgets').post((ctx: any) => sendError(ctx, { status: 409 }))
  `,
  'shared-dynamic-quoted-error': `
    declare const app: any
    function sendError(ctx: any, error: any) {
      ctx.setStatus(error.status)
      ctx.json({ 'error': error.message })
    }
    app.route('/api/v1/items').post((ctx: any) => sendError(ctx, { status: 409 }))
    app.route('/api/v1/widgets').post((ctx: any) => sendError(ctx, { status: 409 }))
  `,
  'shared-dynamic-computed-error': `
    declare const app: any
    function sendError(ctx: any, error: any) {
      ctx.setStatus(error.status)
      ctx.json({ ['error']: error.message })
    }
    app.route('/api/v1/items').post((ctx: any) => sendError(ctx, { status: 409 }))
    app.route('/api/v1/widgets').post((ctx: any) => sendError(ctx, { status: 409 }))
  `,
  'shared-local-alias': `
    declare const app: any
    function send(ctx: any) { ctx.json({ shared: true }) }
    const alias = send
    app.route('/api/v1/items').post(send)
    app.route('/api/v1/widgets').post(alias)
  `,
  'cyclic-local-aliases': `
    declare const app: any
    function send(ctx: any) { ctx.json({ shared: true }) }
    const first: any = second
    const second: any = first
    app.route('/api/v1/items').post(first)
    app.route('/api/v1/widgets').post(second)
  `,
  'reassigned-local-alias': `
    declare const app: any
    function sendA(ctx: any) { ctx.json({ a: true }) }
    function sendB(ctx: any) { ctx.json({ b: true }) }
    let alias = sendA
    alias = sendB
    app.route('/api/v1/a').post(sendA)
    app.route('/api/v1/b').post(alias)
  `,
  'unresolved-local-alias': `
    declare const app: any
    const alias: any = missingHandler
    app.route('/api/v1/items').post(alias)
  `,
  'shared-dynamic-success': `
    declare const app: any
    function sendItem(ctx: any, created: any) {
      ctx.setStatus(created ? 201 : 200)
      ctx.json({ id: 'one' as string })
    }
    app.route('/api/v1/items').post((ctx: any) => sendItem(ctx, true))
    app.route('/api/v1/widgets').post((ctx: any) => sendItem(ctx, false))
  `,
  'shared-nested-single': `
    declare const app: any
    function sendShared(ctx: any) {
      function sendNested(nested: any) { nested.json({ nested: true }) }
      app.route('/api/v1/nested').get(sendNested)
      ctx.json({ shared: true })
    }
    app.route('/api/v1/items').post(sendShared)
    app.route('/api/v1/widgets').post(sendShared)
  `,
  'shared-multiple': `
    declare const app: any
    function sendBoth(ctx: any) {
      ctx.json({ id: 'one' as string })
      ctx.response.xml('<item/>')
    }
    app.route('/api/v1/widgets').post((ctx: any) => sendBoth(ctx))
    app.route('/api/v1/items').post((ctx: any) => sendBoth(ctx))
    app.route('/api/v1/items').post((ctx: any) => sendBoth(ctx))
  `,
  'shared-plain-pipeline': `
    declare const app: any, stream: unknown
    function sendStream(ctx: any) { ctx.pipeline(stream) }
    app.route('/api/v1/items').post((ctx: any) => sendStream(ctx))
    app.route('/api/v1/widgets').post((ctx: any) => sendStream(ctx))
  `,
  'shared-stream-json': `
    declare const app: any, streamJsonObject: any
    function sendItem(ctx: any) { ctx.pipeline(streamJsonObject({ id: 'one' as string })) }
    app.route('/api/v1/items').post((ctx: any) => sendItem(ctx))
    app.route('/api/v1/widgets').post((ctx: any) => sendItem(ctx))
  `,
  'shared-stream-json-error': `
    declare const app: any, streamJsonObject: any
    function sendError(ctx: any) {
      ctx.setStatus(409)
      ctx.pipeline(streamJsonObject({ error: 'conflict' as string }))
    }
    app.route('/api/v1/items').post((ctx: any) => sendError(ctx))
    app.route('/api/v1/widgets').post((ctx: any) => sendError(ctx))
  `,
  'shared-unreachable': `
    declare const app: any
    function sendUnused(ctx: any) {
      if (false) ctx.json({ dead: true })
      return
      ctx.response.xml('<dead/>')
      function neverCalled(inner: any) { inner.json({ dead: true }) }
    }
    app.route('/api/v1/items').post(sendUnused)
    app.route('/api/v1/widgets').post(sendUnused)
  `,
  'nested-route-handler': `
    declare const app: any
    function sendShared(ctx: any) { ctx.json({ shared: true }) }
    app.route('/api/v1/outer').post((ctx: any) => {
      app.route('/api/v1/inner').get((inner: any) => sendShared(inner))
    })
    app.route('/api/v1/other').post(sendShared)
  `,
  'shared-xml': `
    declare const app: any
    function sendXml(ctx: any) { ctx.response.xml('<item/>') }
    app.route('/api/v1/items').post((ctx: any) => sendXml(ctx))
    app.route('/api/v1/widgets').post((ctx: any) => sendXml(ctx))
  `,
  'shared-buffer': `
    declare const app: any
    function sendBuffer(ctx: any) { ctx.response.buffer(new Uint8Array()) }
    app.route('/api/v1/items').post((ctx: any) => sendBuffer(ctx))
    app.route('/api/v1/widgets').post((ctx: any) => sendBuffer(ctx))
  `,
  'shared-empty': `
    declare const app: any
    function sendEmpty(ctx: any) { ctx.response.empty() }
    app.route('/api/v1/items').post((ctx: any) => sendEmpty(ctx))
    app.route('/api/v1/widgets').post((ctx: any) => sendEmpty(ctx))
  `,
  'marker-pipeline': `
    declare const ctx: any, apiResponse: any
    ctx.pipeline(() => apiResponse('GET:/items', { id: 'one' }))
  `,
  'unscoped-call': `
    declare const ctx: any
    function unregistered(ctx: any) { ctx.json({ id: 'one' }) }
  `,
} as const

let matrix: ReturnType<typeof buildVirtualProgramMatrix<keyof typeof sources>>

function discover(sourceId: keyof typeof sources, facts?: AmbiguousAttributionFact[]) {
  return discoverMany([sourceId], facts)
}

function discoverMany(
  sourceIds: readonly (keyof typeof sources)[],
  facts?: AmbiguousAttributionFact[],
) {
  return discoverApiResponseContracts(
    matrix.program,
    sourceIds.map((sourceId) => matrix.sourceFile(sourceId)),
    undefined,
    facts ? { onAmbiguousAttribution: (fact) => facts.push(fact) } : undefined,
  )
}

function firstCallLabel(sourceId: 'marker-pipeline'): string | undefined {
  const source = matrix.sourceFile(sourceId)
  let label: string | undefined
  visit(source, (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'ctx.pipeline') {
      label = implicitResponseCallLabel(node)
    }
  })
  return label
}

describe('implicit response attribution facts', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('emits one sorted fact for a shared helper while preserving default discovery output', () => {
    const facts: AmbiguousAttributionFact[] = []
    const normal = discover('shared-json')
    const strict = discover('shared-json', facts)

    expect(strict).toEqual(normal)
    expect(facts).toEqual([
      {
        sourceLocation: '/virtual/shared-json.ts:4:7',
        label: 'ctx.json()',
        routes: ['POST:/api/v1/items', 'POST:/api/v1/widgets'],
      },
    ])
  })

  it('attributes handlers passed by reference to the same ambiguous route binding', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('shared-reference', facts)

    expect(facts[0]).toMatchObject({
      label: 'ctx.json()',
      routes: ['POST:/api/v1/items', 'POST:/api/v1/widgets'],
    })
  })

  it('keeps response calls lexically inside each route and single-route helpers unambiguous', () => {
    for (const sourceId of ['per-route', 'single-route'] as const) {
      const facts: AmbiguousAttributionFact[] = []
      discover(sourceId, facts)
      expect(facts).toEqual([])
    }
  })

  it('ignores candidate calls outside all handler functions', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('unscoped-call', facts)
    expect(facts).toEqual([])
  })

  it('excludes dead calls after terminators and in never-invoked functions', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('shared-unreachable', facts)
    expect(facts).toEqual([])
  })

  it('does not attribute a nested route handler to its enclosing route', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('nested-route-handler', facts)
    expect(facts.map(({ routes }) => routes)).toEqual([['GET:/api/v1/inner', 'POST:/api/v1/other']])
  })

  it('filters facts to requested routes without losing the full ambiguous route set', () => {
    const sourceFile = matrix.sourceFile('shared-json')
    const facts: AmbiguousAttributionFact[] = []
    discoverApiResponseContracts(matrix.program, [sourceFile], new Set(['POST:/api/v1/other']), {
      onAmbiguousAttribution: (fact) => facts.push(fact),
    })
    expect(facts).toEqual([])

    discoverApiResponseContracts(matrix.program, [sourceFile], new Set(['POST:/api/v1/items']), {
      onAmbiguousAttribution: (fact) => facts.push(fact),
    })
    expect(facts[0]?.routes).toEqual(['POST:/api/v1/items', 'POST:/api/v1/widgets'])
  })

  it('does not report status-only or error-branch helper calls', () => {
    for (const sourceId of [
      'shared-status',
      'shared-error',
      'shared-dynamic-error',
      'shared-stream-json-error',
    ] as const) {
      const facts: AmbiguousAttributionFact[] = []
      discover(sourceId, facts)
      expect(facts).toEqual([])
    }
  })

  it('excludes dynamic error payloads with quoted and computed error keys', () => {
    for (const sourceId of [
      'shared-dynamic-quoted-error',
      'shared-dynamic-computed-error',
    ] as const) {
      const facts: AmbiguousAttributionFact[] = []
      discover(sourceId, facts)
      expect(facts).toEqual([])
    }
  })

  it('groups direct and local-alias registrations under the same shared handler', () => {
    const facts: AmbiguousAttributionFact[] = []
    const normal = discover('shared-local-alias')
    const withFacts = discover('shared-local-alias', facts)
    expect(withFacts).toEqual(normal)
    expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
      {
        label: 'ctx.json()',
        routes: ['POST:/api/v1/items', 'POST:/api/v1/widgets'],
      },
    ])
  })

  it('stops resolving malformed cyclic local handler aliases', () => {
    const facts: AmbiguousAttributionFact[] = []
    const source = matrix.program.getSourceFile('/virtual/cyclic-local-aliases.ts')!
    expect(() =>
      discoverApiResponseContracts(matrix.program, [source], undefined, {
        onAmbiguousAttribution: (fact) => facts.push(fact),
      }),
    ).not.toThrow()
    expect(facts).toEqual([])
  })

  it('does not follow mutable handler aliases after reassignment', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('reassigned-local-alias', facts)
    expect(facts).toEqual([])
  })

  it('fails closed when a local handler alias has no checker symbol', () => {
    const source = matrix.program.getSourceFile('/virtual/unresolved-local-alias.ts')!
    let unresolved: ts.Identifier | undefined
    visit(source, (node) => {
      if (ts.isIdentifier(node) && node.text === 'missingHandler') unresolved = node
    })
    expect(matrix.program.getTypeChecker().getSymbolAtLocation(unresolved!)).toBeUndefined()
    const facts: AmbiguousAttributionFact[] = []
    expect(
      discoverApiResponseContracts(matrix.program, [source], undefined, {
        onAmbiguousAttribution: (fact) => facts.push(fact),
      }),
    ).toEqual({})
    expect(facts).toEqual([])
  })

  it('reports success emitters with dynamic statuses', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('shared-dynamic-success', facts)

    expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
      {
        label: 'ctx.json()',
        routes: ['POST:/api/v1/items', 'POST:/api/v1/widgets'],
      },
    ])
  })

  it('stops ancestry at an unambiguous nested handler before an ambiguous outer helper', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('shared-nested-single', facts)

    expect(facts).toHaveLength(1)
    expect(facts[0]?.routes).toEqual(['POST:/api/v1/items', 'POST:/api/v1/widgets'])
  })

  it('deduplicates and sorts routes while reporting each distinct shared emission', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('shared-multiple', facts)

    expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
      {
        label: 'ctx.json()',
        routes: ['POST:/api/v1/items', 'POST:/api/v1/widgets'],
      },
      {
        label: 'ctx.response.xml()',
        routes: ['POST:/api/v1/items', 'POST:/api/v1/widgets'],
      },
    ])
  })

  it('reports unmarked raw pipelines through the same attribution callback', () => {
    const facts: AmbiguousAttributionFact[] = []
    discover('shared-plain-pipeline', facts)

    expect(facts.map(({ label }) => label)).toEqual(['ctx.pipeline()'])
  })

  it('resolves an aliased imported handler registered on two routes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'response-attribution-'))
    const handlerPath = join(directory, 'handler.ts')
    const routesPath = join(directory, 'routes.ts')
    try {
      await writeFile(
        handlerPath,
        `export function sendImported(ctx: any) { ctx.json({ imported: true }) }`,
      )
      await writeFile(
        routesPath,
        `import { sendImported as send } from './handler.js'\ndeclare const app: any\napp.route('/api/v1/items').post(send)\napp.route('/api/v1/widgets').post(send)`,
      )
      const program = ts.createProgram([handlerPath, routesPath], {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ESNext,
        strict: true,
        skipLibCheck: true,
      })
      const sources = [program.getSourceFile(handlerPath), program.getSourceFile(routesPath)]
      expect(sources.every(Boolean)).toBe(true)
      const facts: AmbiguousAttributionFact[] = []
      discoverApiResponseContracts(
        program,
        sources.filter((source): source is ts.SourceFile => !!source),
        undefined,
        { onAmbiguousAttribution: (fact) => facts.push(fact) },
      )
      expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
        {
          label: 'ctx.json()',
          routes: ['POST:/api/v1/items', 'POST:/api/v1/widgets'],
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['shared-stream-json', 'ctx.pipeline()'],
    ['shared-xml', 'ctx.response.xml()'],
    ['shared-buffer', 'ctx.response.buffer()'],
    ['shared-empty', 'ctx.response.empty()'],
  ] as const)('labels ambiguous %s emissions through the shared classifier', (sourceId, label) => {
    const facts: AmbiguousAttributionFact[] = []
    discover(sourceId, facts)
    expect(facts.map((fact) => fact.label)).toEqual([label])
  })

  it('does not label a pipeline that contains an explicit response marker', () => {
    expect(firstCallLabel('marker-pipeline')).toBeUndefined()
  })
})
