import { beforeAll, expect, it } from 'vitest'

import ts from '../contract-schema/typescript-api.mts'

import {
  discoverApiResponseContracts,
  type AmbiguousAttributionFact,
  type BackendResponseContract,
} from './index.mts'
import { attributionSymbol } from './response-contract-symbols.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const protocolTypes = `
  declare const app: any
  type Http<T> = Response & { readonly apiHttpResponseVariants?: T }
  declare function apiOpenApiHttpResponse<K extends string, T>(key: K, value: Http<T>): Http<T>
  type Good = { status: 200; bodyKind: 'content'; mediaType: 'application/json'; body: { ok: boolean } }
  type Bad = { status: 202; bodyKind: 'none' }
  declare const value: Http<Good | Bad>
`

const sources = {
  'array-assignment': `
    declare const app: any
    function replacement(ctx: any) { ctx.json({ replacement: true }) }
    let send: any = (ctx: any) => ctx.json({ original: true })
    app.route('/a').post(send)
    ;[send] = [replacement]
    ;[, send] = [replacement, replacement]
    ;[...send] = [replacement]
    app.route('/b').post(send)
  `,
  'loop-target-assignment': `
    declare const app: any
    const replacement = (ctx: any) => ctx.json({ replacement: true })
    let send: any = (ctx: any) => ctx.json({ original: true })
    app.route('/a').post(send)
    for (send of [replacement]) {}
    for (send in { replacement }) {}
    app.route('/b').post(send)
  `,
  'object-assignment': `
    declare const app: any
    function replacement(ctx: any) { ctx.json({ replacement: true }) }
    let send = (ctx: any) => ctx.json({ original: true })
    app.route('/a').post(send)
    ;({ handler: send } = { handler: replacement })
    ;({ send } = { send: replacement })
    app.route('/b').post(send)
  `,
  'property-target-assignment': `
    declare const app: any
    function replacement(ctx: any) { ctx.json({ replacement: true }) }
    function send(ctx: any) { ctx.json({ shared: true }) }
    const receiver: { handler: (ctx: any) => void } = { handler: send }
    app.route('/a').post(send)
    ;({ handler: receiver.handler } = { handler: replacement })
    app.route('/b').post(send)
  `,
  'object-rest-assignment': `
    declare const app: any
    function replacement(ctx: any) { ctx.json({ replacement: true }) }
    let send: any = (ctx: any) => ctx.json({ original: true })
    app.route('/a').post(send)
    ;({ ...send } = { send: replacement })
    app.route('/b').post(send)
  `,
  'parenthesized-property-assignment': `
    declare const app: any
    function replacement(ctx: any) { ctx.json({ replacement: true }) }
    const handlers = { send(ctx: any) { ctx.json({ original: true }) } }
    app.route('/a').post(handlers.send)
    ;(handlers.send) = replacement
    app.route('/b').post(handlers.send)
  `,
  'typed-property-handler': `
    declare const app: any
    type Handlers = { send(ctx: any): void }
    const handlers: Handlers = { send(ctx) { ctx.json({ shared: true }) } }
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'reassigned-mutable-property-receiver': `
    declare const app: any
    type Handlers = { send(ctx: any): void }
    let handlers: Handlers = { send(ctx) { ctx.json({ original: true }) } }
    app.route('/a').post(handlers.send)
    handlers = { send(ctx) { ctx.json({ replacement: true }) } }
    app.route('/b').post(handlers.send)
  `,
  'mutated-property-before-const-alias': `
    declare const app: any
    type Handlers = { send(ctx: any): void }
    const handlers: Handlers = { send(ctx) { ctx.json({ original: true }) } }
    handlers.send = (ctx) => ctx.json({ replacement: true })
    const alias = handlers.send
    app.route('/a').post(alias)
    app.route('/b').post(alias)
  `,
  'polymorphic-class-property-handler': `
    declare const app: any
    class Base { send(ctx: any) { ctx.json({ base: true }) } }
    class Derived extends Base { send(ctx: any) { ctx.json({ derived: true }) } }
    const controller: Base = new Derived()
    app.route('/a').post(controller.send)
    app.route('/b').post(controller.send)
  `,
  'property-handler-alias': `
    declare const app: any
    type Handlers = { send(ctx: any): void }
    const handlers: Handlers = { send(ctx) { ctx.json({ shared: true }) } }
    const alias = handlers.send
    app.route('/a').post(handlers.send)
    app.route('/b').post(alias)
  `,
  'computed-property-handler': `
    declare const app: any
    type Handlers = { send(ctx: any): void }
    const handlers: Handlers = { ['send'](ctx) { ctx.json({ shared: true }) } }
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'identifier-valued-property-handler': `
    declare const app: any
    function send(ctx: any) { ctx.json({ shared: true }) }
    const alias = send
    const handlers = { handler: alias }
    app.route('/a').post(handlers.handler)
    app.route('/b').post(handlers.handler)
  `,
  'dynamic-computed-property-handler': `
    declare const app: any
    declare const handlerName: string
    type Handlers = {
      send?(ctx: any): void
      [key: string]: ((ctx: any) => void) | undefined
    }
    const handlers: Handlers = { [handlerName](ctx) { ctx.json({ shared: true }) } }
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'bigint-property-handler': `
    declare const app: any
    type Handlers = {
      send?(ctx: any): void
      [key: string]: ((ctx: any) => void) | undefined
    }
    const handlers: Handlers = { 1n(ctx) { ctx.json({ shared: true }) } }
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'spread-property-handler': `
    declare const app: any
    type Handlers = { send(ctx: any): void }
    const base = { send(ctx: any) { ctx.json({ shared: true }) } }
    const handlers: Handlers = { ...base }
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'optional-property-handler': `
    declare const app: any
    type Handlers = { send?(ctx: any): void }
    const handlers: Handlers = {}
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'factory-property-handler': `
    declare const app: any
    type Handlers = { send(ctx: any): void }
    declare function makeHandlers(): Handlers
    const handlers = makeHandlers()
    app.route('/a').post(handlers.send)
    app.route('/b').post(handlers.send)
  `,
  'parameter-property-handler': `
    declare const app: any
    type Handlers = { send(ctx: any): void }
    function attach(handlers: Handlers) {
      app.route('/a').post(handlers.send)
      app.route('/b').post(handlers.send)
    }
  `,
  'wrapped-computed-error': `
    declare const app: any
    function send(ctx: any, status: any, message: string) {
      ctx.setStatus(status)
      ctx.json({ [(('error' as const))]: message })
    }
    app.route('/a').post((ctx: any) => send(ctx, 409, 'failed'))
    app.route('/b').post((ctx: any) => send(ctx, 409, 'failed'))
  `,
  'protocol-variant-and-ambiguous-helper': `${protocolTypes}
    function send(ctx: any) { ctx.json({ shared: true }) }
    app.route('/rpc').post((ctx: any) => {
      const response = apiOpenApiHttpResponse('POST:/rpc', value)
      ctx.setStatus(response.status)
      if (!response.body) ctx.response.empty()
      else ctx.pipeline(response.body)
      send(ctx)
    })
    app.route('/other').post(send)
  `,
  'conditional-status-overwrite': `
    declare const app: any
    function send(ctx: any, status: any, recovered: boolean) {
      ctx.setStatus(status)
      if (recovered) ctx.setStatus(200)
      ctx.json({ error: 'conditional recovery' })
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status, true))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status, false))
  `,
  'short-circuit-status-overwrite': `
    declare const app: any
    function send(ctx: any, status: any, recovered: boolean) {
      ctx.setStatus(status)
      recovered && ctx.setStatus(200)
      ctx.json({ error: 'conditional recovery' })
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status, true))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status, false))
  `,
  'ternary-status-overwrite': `
    declare const app: any
    function send(ctx: any, status: any, recovered: boolean) {
      ctx.setStatus(status)
      recovered ? ctx.setStatus(200) : undefined
      ctx.json({ error: 'conditional recovery' })
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status, true))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status, false))
  `,
  'nested-callback-status-setter': `
    declare const app: any
    function send(ctx: any, status: any, shouldRecover: boolean) {
      ctx.setStatus(status)
      if (shouldRecover) {
        const recover = () => ctx.setStatus(200)
      }
      ctx.json({ error: 'still on dynamic status' })
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status, true))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status, false))
  `,
  'non-data-error-property': `
    declare const app: any
    function send(ctx: any, status: any) {
      ctx.setStatus(status)
      ctx.json({ error() { return 'not an error data field' } })
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status))
  `,
  'numeric-error-object-key': `
    declare const app: any
    function send(ctx: any, status: any) {
      ctx.setStatus(status)
      ctx.json({ 1: 'not an error data field' })
    }
    app.route('/a').post((ctx: any) => send(ctx, ctx.query.status))
    app.route('/b').post((ctx: any) => send(ctx, ctx.query.status))
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})

function discover(
  sourceId: keyof typeof sources,
  requestedKeys?: ReadonlySet<string>,
  lenient = false,
): { contracts: Record<string, BackendResponseContract>; facts: AmbiguousAttributionFact[] } {
  const facts: AmbiguousAttributionFact[] = []
  const contracts = discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(sourceId)],
    requestedKeys,
    {
      onAmbiguousAttribution: (fact) => facts.push(fact),
      ...(lenient ? { onRouteError: () => {} } : {}),
    },
  )
  return { contracts, facts }
}

it.each([
  'array-assignment',
  'loop-target-assignment',
  'object-assignment',
  'object-rest-assignment',
  'parenthesized-property-assignment',
] as const)('excludes handler bindings written by %s', (sourceId) => {
  expect(discover(sourceId).facts).toEqual([])
})

it('does not treat a nested property assignment target as a reassigned local binding', () => {
  const { facts } = discover('property-target-assignment')
  expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
    { label: 'ctx.json()', routes: ['POST:/a', 'POST:/b'] },
  ])
})

it('resolves a contextually typed object handler to its implementation', () => {
  const { facts } = discover('typed-property-handler')
  expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
    { label: 'ctx.json()', routes: ['POST:/a', 'POST:/b'] },
  ])
})

it('fails closed when a mutable property receiver is reassigned', () => {
  expect(discover('reassigned-mutable-property-receiver').facts).toEqual([])
})

it('fails closed when a property alias hides an earlier direct reassignment', () => {
  expect(discover('mutated-property-before-const-alias').facts).toEqual([])
})

it('fails closed for polymorphic class receivers outside object-literal resolution', () => {
  expect(discover('polymorphic-class-property-handler').facts).toEqual([])
})

it.each([
  'property-handler-alias',
  'computed-property-handler',
  'identifier-valued-property-handler',
] as const)('resolves %s to its object-literal implementation', (sourceId) => {
  const { facts } = discover(sourceId)
  expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
    { label: 'ctx.json()', routes: ['POST:/a', 'POST:/b'] },
  ])
})

it('keeps a dynamic object property name on the contextual symbol fallback', () => {
  expect(discover('dynamic-computed-property-handler').facts).toEqual([])
})

it('keeps a bigint object property name on the contextual symbol fallback', () => {
  expect(discover('bigint-property-handler').facts).toEqual([])
})

it.each(['spread-property-handler', 'optional-property-handler'] as const)(
  'keeps unsupported object initializer %s on the contextual symbol fallback',
  (sourceId) => {
    expect(discover(sourceId).facts).toEqual([])
  },
)

it('keeps factory-created typed handlers on the contextual symbol fallback', () => {
  expect(discover('factory-property-handler').facts).toEqual([])
})

it('keeps parameter-owned typed handlers on the contextual symbol fallback', () => {
  expect(discover('parameter-property-handler').facts).toEqual([])
})

it('retains a checker symbol when its declaration name is inside a with region', () => {
  const fileName = '/virtual/with-region.ts'
  const sourceText =
    'declare const receiver: any; with (receiver) { var send = function (ctx: any) {} } send;'
  const compilerOptions: ts.CompilerOptions = {
    noLib: true,
    strict: false,
    alwaysStrict: false,
  }
  const host = ts.createCompilerHost(compilerOptions, true)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (requested, languageVersion, onError, shouldCreateNewSourceFile) =>
    requested === fileName
      ? ts.createSourceFile(requested, sourceText, languageVersion, true)
      : originalGetSourceFile(requested, languageVersion, onError, shouldCreateNewSourceFile)
  host.fileExists = (requested) => requested === fileName || ts.sys.fileExists(requested)
  host.readFile = (requested) => (requested === fileName ? sourceText : ts.sys.readFile(requested))
  const program = ts.createProgram([fileName], compilerOptions, host)
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(fileName)!
  const finalStatement = sourceFile.statements.at(-1)!
  expect(ts.isExpressionStatement(finalStatement)).toBe(true)
  if (!ts.isExpressionStatement(finalStatement) || !ts.isIdentifier(finalStatement.expression))
    throw new Error('Expected the final virtual statement to reference send')
  const symbol = checker.getSymbolAtLocation(finalStatement.expression)
  expect(symbol).toBeDefined()
  const declaration = symbol?.valueDeclaration
  expect(declaration && ts.isVariableDeclaration(declaration)).toBe(true)
  if (!declaration || !ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name))
    throw new Error('Expected send to have a variable declaration')
  expect(checker.getSymbolAtLocation(declaration.name)).toBeUndefined()
  expect(attributionSymbol(symbol!, checker)).toBe(symbol)
})

it('unwraps computed error keys before applying the dynamic-error exclusion', () => {
  expect(discover('wrapped-computed-error').facts).toEqual([])
})

it('keeps protocol-suffixed requested routes eligible for attribution facts', () => {
  expect(() =>
    discover('protocol-variant-and-ambiguous-helper', new Set(['POST:/rpc#protocol-2'])),
  ).toThrow('HTTP response context escapes through an opaque argument')
  const { contracts, facts } = discover(
    'protocol-variant-and-ambiguous-helper',
    new Set(['POST:/rpc#protocol-2']),
    true,
  )
  expect(contracts['POST:/rpc#protocol-2']).toMatchObject({
    schema: { root: { type: 'unknown' } },
    unavailableReason: 'HTTP response context escapes through an opaque argument',
  })
  expect(facts.map(({ routes }) => routes)).toEqual([['POST:/other', 'POST:/rpc']])
})

it('does not reuse a dynamic status across a conditional status overwrite', () => {
  const { facts } = discover('conditional-status-overwrite')
  expect(facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
    { label: 'ctx.json()', routes: ['POST:/a', 'POST:/b'] },
  ])
})

it.each(['short-circuit-status-overwrite', 'ternary-status-overwrite'] as const)(
  'does not reuse a dynamic status across expression-level overwrite in %s',
  (sourceId) => {
    expect(discover(sourceId).facts.map(({ label, routes }) => ({ label, routes }))).toEqual([
      { label: 'ctx.json()', routes: ['POST:/a', 'POST:/b'] },
    ])
  },
)

it('does not treat a nested callback status setter as an executed conditional overwrite', () => {
  expect(discover('nested-callback-status-setter').facts).toEqual([])
})

it('does not classify a method named error as an error data object', () => {
  expect(
    discover('non-data-error-property').facts.map(({ label, routes }) => ({ label, routes })),
  ).toEqual([{ label: 'ctx.json()', routes: ['POST:/a', 'POST:/b'] }])
})

it('does not classify a numeric object key as an error field', () => {
  expect(
    discover('numeric-error-object-key').facts.map(({ label, routes }) => ({ label, routes })),
  ).toEqual([{ label: 'ctx.json()', routes: ['POST:/a', 'POST:/b'] }])
})
