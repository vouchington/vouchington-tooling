import { beforeAll, expect, it } from 'vitest'

import ts from '../contract-schema/typescript-api.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts, type AmbiguousAttributionFact } from './index.mts'
import { destructuredPropertyImplementationSymbol } from './response-contract-object-symbols.mts'

const sources = {
  'block-status-write': `
    declare const app: any
    function send(ctx: any, status: any) {
      ctx.setStatus(status)
      { ctx.setStatus(200) }
      ctx.json({ error: 'message' })
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status))
  `,
  'variable-status-write': `
    declare const app: any
    function send(ctx: any, status: any, recovered: boolean) {
      ctx.setStatus(status)
      const result = recovered && ctx.setStatus(200)
      ctx.json({ error: result })
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status, true))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status, false))
  `,
  'receiver-alias-mutation': `
    declare const app: any
    const handlers = { send(ctx: any) { ctx.json({ original: true }) } }
    const alias = handlers
    alias.send = (ctx: any) => ctx.json({ replacement: true })
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'inline-receiver-alias-mutation': `
    declare const app: any
    const handlers = { send(ctx: any) { ctx.json({ original: true }) } }
    const alias = handlers
    alias.send = (ctx: any) => ctx.json({ replacement: true })
    app.route('/a').post((ctx: any) => alias.send(ctx))
    app.route('/b').post((ctx: any) => alias.send(ctx))
  `,
  'immutable-body-alias': `
    declare const app: any
    function send(ctx: any, status: any, message: string) {
      ctx.setStatus(status)
      const body = { error: message }
      ctx.json(body)
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status, 'a'))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status, 'b'))
  `,
  'mutable-body-alias': `
    declare const app: any
    function send(ctx: any, status: any, message: string) {
      ctx.setStatus(status)
      let body = { error: message }
      ctx.json(body)
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status, 'a'))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status, 'b'))
  `,
  'cyclic-body-alias': `
    declare const app: any
    function send(ctx: any, status: any) {
      ctx.setStatus(status)
      const body: any = other
      const other: any = body
      ctx.json(body)
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status))
  `,
  'rest-binding-assignment': `
    declare const app: any
    let send: any = (ctx: any) => ctx.json({ original: true })
    declare const replacement: any
    ;({ ...send } = replacement)
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'destructured-handler': `
    declare const app: any
    const handlers = { send(ctx: any) { ctx.json({ shared: true }) } }
    const { send } = handlers
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'dynamic-destructured-handler': `
    declare const app: any
    declare function makeHandlers(): { send(ctx: any): void }
    const { send } = makeHandlers()
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'rest-destructured-handler': `
    declare const app: any
    const handlers = { send(ctx: any) { ctx.json({ shared: true }) } }
    const { ...send } = handlers
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'defaulted-destructured-handler': `
    declare const app: any
    function fallback(ctx: any) { ctx.json({ fallback: true }) }
    const handlers = { send(ctx: any) { ctx.json({ shared: true }) } }
    const { send = fallback } = handlers
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'getter-handler': `
    declare const app: any
    declare const ctx: any
    const handlers = {
      get send() {
        ctx.json({ getter: true })
        return (response: any) => response.json({ actual: true })
      },
    }
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'parameter-destructured-handler': `
    declare const app: any
    declare const ctx: any
    app.route('/a').post(({ send }: any) => send(ctx))
    app.route('/b').post(({ send }: any) => send(ctx))
  `,
  'ambient-handler-alias': `
    declare const app: any
    declare const importedHandlers: any
    const send = importedHandlers.send
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'namespace-handler': `
    declare const app: any
    function handlers() {}
    namespace handlers {
      export function send(ctx: any) { ctx.json({ shared: true }) }
    }
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'ambient-destructured-handler': `
    declare const app: any
    declare const importedHandlers: any
    const { send } = importedHandlers
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'array-destructured-handler': `
    declare const app: any
    const [send] = [(ctx: any) => ctx.json({ shared: true })]
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'computed-destructured-handler': `
    declare const app: any
    const key = 'send'
    const handlers = { send(ctx: any) { ctx.json({ shared: true }) } }
    const { [key]: send } = handlers
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'cyclic-handler-alias': `
    declare const app: any
    const handlers: any = alias
    const alias: any = handlers
    const { send } = handlers
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
  'unreachable-route-registration': `
    declare const app: any
    function send(ctx: any) { ctx.json({ shared: true }) }
    app.route('/a').post(send)
    if (false) app.route('/b').post(send)
  `,
  'exported-route-builder': `
    declare const app: any
    function send(ctx: any) { ctx.json({ shared: true }) }
    export function registerRoutes() {
      app.route('/a').post(send)
      app.route('/b').post(send)
    }
  `,
  'mutated-property-direct-registration': `
    declare const app: any
    function send(ctx: any) { ctx.json({ shared: true }) }
    const handlers = { handler: send }
    handlers.handler = (ctx: any) => ctx.json({ replacement: true })
    const methods = { emit(ctx: any) { ctx.json({ original: true }) } }
    const { emit: alias } = methods
    methods.emit = (ctx: any) => ctx.json({ replacement: true })
    app.route('/a').post(handlers.handler)
    app.route('/b').post(handlers.handler)
    app.route('/c').post(send)
    app.route('/d').post(send)
    app.route('/e').post(alias)
    app.route('/f').post(alias)
  `,
  'factory-receiver-handler': `
    declare const app: any
    class Base {
      send(ctx: any) { ctx.json({ base: true }) }
    }
    class Derived extends Base {
      send(ctx: any) { ctx.json({ derived: true }) }
    }
    declare function make(): Base
    app.route('/a').post(make().send)
    app.route('/b').post(make().send)
  `,
  'unreachable-status-write': `
    declare const app: any
    function send(ctx: any, status: any, message: string) {
      ctx.setStatus(200)
      if (false) ctx.setStatus(status)
      ctx.json({ error: message })
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status, 'a'))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status, 'b'))
  `,
  'invalid-marker-after-fact': `
    declare const app: any
    function send(ctx: any) { ctx.json({ shared: true }) }
    app.route('/a').post(send)
    app.route('/b').post(send)
    apiResponse()
  `,
  'ordered-source-z': `
    declare const app: any
    function send(ctx: any) {
      ctx.json({ first: true })
      ctx.json({ second: true })
    }
    app.route('/z').post(send)
    app.route('/zz').post(send)
  `,
  'ordered-source-a': `
    declare const app: any
    function send(ctx: any) { ctx.json({ only: true }) }
    app.route('/a').post(send)
    app.route('/aa').post(send)
  `,
  'literal-error-emitters': `
    declare const app: any
    function send(ctx: any) {
      ctx.setStatus(404)
      ctx.response.xml('<error/>')
      ctx.response.buffer(new Uint8Array())
      ctx.response.empty()
      ctx.pipeline({ error: 'not-json' })
    }
    app.route('/a').post(send)
    app.route('/b').post(send)
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})

function discover(sourceId: keyof typeof sources, callback = true) {
  const facts: AmbiguousAttributionFact[] = []
  const options = callback
    ? { onAmbiguousAttribution: (fact: AmbiguousAttributionFact) => facts.push(fact) }
    : undefined
  const contracts = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(sourceId)],
    undefined,
    options,
  )
  return { contracts, facts }
}

function discoverUnchecked(sourceId: keyof typeof sources) {
  const sourceFile = matrix.program.getSourceFile(`/virtual/${sourceId}.ts`)
  if (!sourceFile) throw new Error(`Missing virtual source ${sourceId}`)
  return discoverApiResponseContracts(matrix.program, [sourceFile], undefined, {
    onAmbiguousAttribution: () => undefined,
  })
}

function firstBindingElement(sourceId: keyof typeof sources): ts.BindingElement {
  const sourceFile = matrix.program.getSourceFile(`/virtual/${sourceId}.ts`)
  if (!sourceFile) throw new Error(`Missing virtual source ${sourceId}`)
  let found: ts.BindingElement | undefined
  const visit = (node: ts.Node): void => {
    if (!found && ts.isBindingElement(node)) found = node
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (!found) throw new Error(`Missing binding element in ${sourceId}`)
  return found
}

it.each(['block-status-write', 'variable-status-write'] as const)(
  'fails open when %s may overwrite a prior dynamic status',
  (sourceId) => {
    expect(discover(sourceId).facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
      { label: 'ctx.json()', routes: ['POST:/a', 'POST:/b'] },
    ])
  },
)

it.each(['receiver-alias-mutation', 'inline-receiver-alias-mutation'] as const)(
  'excludes handlers mutated through a const receiver alias in %s',
  (sourceId) => expect(discover(sourceId).facts).toEqual([]),
)

it('uses a const error-body alias only for opt-in ambiguity classification', () => {
  expect(discover('immutable-body-alias').facts).toEqual([])
  expect(discover('immutable-body-alias', false).contracts).toEqual(
    discover('immutable-body-alias', true).contracts,
  )
  expect(discover('mutable-body-alias').facts).toHaveLength(1)
})

it('fails closed on cyclic aliases in a diagnostic-bearing compiler program', () => {
  const sourceFile = matrix.program.getSourceFile('/virtual/cyclic-body-alias.ts')!
  expect(matrix.program.getSemanticDiagnostics(sourceFile).length).toBeGreaterThan(0)
  expect(() => discoverUnchecked('cyclic-body-alias')).not.toThrow()
})

it('resolves const destructured handlers and fails closed on unknown destructuring sources', () => {
  expect(discover('destructured-handler').facts.map(({ routes }) => routes)).toEqual([
    ['POST:/a', 'POST:/b'],
  ])
  expect(discover('dynamic-destructured-handler').facts).toEqual([])
  expect(discover('rest-destructured-handler').facts).toEqual([])
  expect(discover('defaulted-destructured-handler').facts).toEqual([])
  expect(discover('getter-handler').facts).toEqual([])
  expect(discover('parameter-destructured-handler').facts).toEqual([])
  expect(discover('ambient-handler-alias').facts).toEqual([])
  expect(discover('ambient-destructured-handler').facts).toEqual([])
  expect(discover('namespace-handler').facts.map(({ routes }) => routes)).toEqual([
    ['POST:/a', 'POST:/b'],
  ])
})

it('fails closed for unsupported compiler binding shapes', () => {
  const checker = matrix.program.getTypeChecker()
  matrix.sourceFile('array-destructured-handler')
  matrix.sourceFile('computed-destructured-handler')
  expect(
    destructuredPropertyImplementationSymbol(
      firstBindingElement('parameter-destructured-handler'),
      checker,
    ),
  ).toBeUndefined()
  expect(
    destructuredPropertyImplementationSymbol(
      firstBindingElement('rest-destructured-handler'),
      checker,
    ),
  ).toBeUndefined()
  expect(
    destructuredPropertyImplementationSymbol(
      firstBindingElement('defaulted-destructured-handler'),
      checker,
    ),
  ).toBeUndefined()
  expect(
    destructuredPropertyImplementationSymbol(
      firstBindingElement('array-destructured-handler'),
      checker,
    ),
  ).toBeUndefined()
  expect(
    destructuredPropertyImplementationSymbol(
      firstBindingElement('computed-destructured-handler'),
      checker,
    ),
  ).toBeUndefined()
  expect(
    destructuredPropertyImplementationSymbol(
      firstBindingElement('ambient-destructured-handler'),
      checker,
    ),
  ).toBeUndefined()
})

it('stops resolving cyclic object aliases in a diagnostic-bearing program', () => {
  const sourceFile = matrix.program.getSourceFile('/virtual/cyclic-handler-alias.ts')!
  expect(matrix.program.getSemanticDiagnostics(sourceFile).length).toBeGreaterThan(0)
  expect(() =>
    destructuredPropertyImplementationSymbol(
      firstBindingElement('cyclic-handler-alias'),
      matrix.program.getTypeChecker(),
    ),
  ).not.toThrow()
})

it('tracks a rest target as a direct handler binding mutation', () => {
  expect(discover('rest-binding-assignment').facts).toEqual([])
})

it('does not count a statically unreachable route registration as ambiguous', () => {
  const withCallback = discover('unreachable-route-registration')
  expect(withCallback.facts).toEqual([])
  expect(withCallback.contracts).toEqual(
    discover('unreachable-route-registration', false).contracts,
  )
})

it('preserves default discovery for exported route builders while attributing their handlers', () => {
  const withCallback = discover('exported-route-builder')
  expect(withCallback.facts.map(({ routes }) => routes)).toEqual([['POST:/a', 'POST:/b']])
  expect(withCallback.contracts).toEqual(discover('exported-route-builder', false).contracts)
})

it('does not let a mutated property suppress direct function registrations', () => {
  expect(
    discover('mutated-property-direct-registration').facts.map(({ routes }) => routes),
  ).toEqual([['POST:/c', 'POST:/d']])
})

it('fails closed for property handlers read through factory receivers', () => {
  expect(discover('factory-receiver-handler').facts).toEqual([])
})

it('ignores dead status setters without changing default discovery', () => {
  const withCallback = discover('unreachable-status-write')
  expect(withCallback.facts).toHaveLength(1)
  expect(withCallback.contracts).toEqual(discover('unreachable-status-write', false).contracts)
})

it('delivers copied attribution facts in source-location order after successful discovery', () => {
  const facts: AmbiguousAttributionFact[] = []
  const handler = matrix.sourceFile('ordered-source-z')
  const sourceFiles = [handler, matrix.sourceFile('ordered-source-a')]
  discoverApiResponseContracts(matrix.program, sourceFiles, undefined, {
    onAmbiguousAttribution: (fact) => {
      if (
        fact.sourceLocation.startsWith('/virtual/ordered-source-z.ts:') &&
        !facts.some(({ sourceLocation }) =>
          sourceLocation.startsWith('/virtual/ordered-source-z.ts:'),
        )
      )
        (fact.routes as string[]).push('MUTATED')
      facts.push(fact)
    },
  })
  const firstColumn = handler.text.split('\n')[3]!.indexOf('ctx.json') + 1
  const secondColumn = handler.text.split('\n')[4]!.indexOf('ctx.json') + 1
  expect(facts.map(({ sourceLocation }) => sourceLocation)).toEqual([
    expect.stringMatching(/^\/virtual\/ordered-source-a\.ts:/),
    `/virtual/ordered-source-z.ts:4:${firstColumn}`,
    `/virtual/ordered-source-z.ts:5:${secondColumn}`,
  ])
  expect(facts.map(({ routes }) => routes)).toEqual([
    ['POST:/a', 'POST:/aa'],
    ['POST:/z', 'POST:/zz', 'MUTATED'],
    ['POST:/z', 'POST:/zz'],
  ])
})

it('does not deliver buffered facts when discovery fails', () => {
  const facts: AmbiguousAttributionFact[] = []
  expect(() =>
    discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile('invalid-marker-after-fact')],
      undefined,
      { onAmbiguousAttribution: (fact) => facts.push(fact) },
    ),
  ).toThrow()
  expect(facts).toEqual([])
})

it('applies literal-error branch exclusion to every emitter without changing default contracts', () => {
  const withCallback = discover('literal-error-emitters')
  expect(withCallback.facts).toEqual([])
  expect(withCallback.contracts).toEqual(discover('literal-error-emitters', false).contracts)
})
