import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import ts from '../contract-schema/typescript-api.mts'
import { discoverRegisteredRoutes } from './registered-route-catalog.mts'
import {
  buildVirtualProgramMatrix,
  COLD_VIRTUAL_PROGRAM_TIMEOUT_MS,
  type VirtualProgramMatrix,
} from './test-setup.test-helpers.mts'

const app = 'declare const app: any'
const sources = {
  'bare-method': `
    ${app}
    app.get(() => {})
  `,
  'missing-argument': `
    ${app}
    function identity(handler?: () => void) { return handler }
    app.route('/api/v1/missing-argument').get(identity())
  `,
  'inline-callable': `
    ${app}
    app.route('/api/v1/inline-callable').get((() => () => {})())
  `,
  'method-factory': `
    ${app}
    const factory = { wrap(handler: () => void) { return handler } }
    app.route('/api/v1/method-factory').get(factory.wrap(() => {}))
  `,
  'declared-factory': `
    ${app}
    declare const wrap: (handler: () => void) => () => void
    app.route('/api/v1/declared-factory').get(wrap(() => {}))
  `,
  'indirect-factory': `
    ${app}
    const create = () => (handler: () => void) => handler
    const wrap = create()
    app.route('/api/v1/indirect-factory').get(wrap(() => {}))
  `,
  'proxy-factory': `
    ${app}
    declare const factories: Record<'dynamic', (handler: () => void) => () => void>
    app.route('/api/v1/proxy-factory').get(factories.dynamic(() => {}))
  `,
  'proxy-handler': `
    ${app}
    declare const handlers: Record<'dynamic', () => void>
    app.route('/api/v1/proxy-handler').get(handlers.dynamic)
  `,
  'declared-function': `
    ${app}
    declare function handler(): void
    app.route('/api/v1/declared-function').get(handler)
  `,
  'declared-variable': `
    ${app}
    declare const handler: () => void
    app.route('/api/v1/declared-variable').get(handler)
  `,
  'direct-function': `
    ${app}
    function handler() { return undefined }
    app.route('/api/v1/direct-function').get(handler)
  `,
  'class-handler': `
    ${app}
    class Handler {}
    app.route('/api/v1/class-handler').get(Handler)
  `,
  'literal-handler': `
    ${app}
    app.route('/api/v1/literal-handler').get(42)
  `,
  'nested-helper': `
    ${app}
    declare function startSSE(ctx: unknown): unknown
    function createHandler() {
      function unrelated() { startSSE({}) }
      return () => undefined
    }
    app.route('/api/v1/nested-helper').get(createHandler())
  `,
  'bare-return': `
    ${app}
    function createHandler(early: boolean) {
      if (early) return
      return () => undefined
    }
    app.route('/api/v1/bare-return').get(createHandler(false))
  `,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>

function routes(sourceId: keyof typeof sources) {
  return discoverRegisteredRoutes(matrix.program, [matrix.sourceFile(sourceId)])
}

describe('registered route structural boundaries', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, COLD_VIRTUAL_PROGRAM_TIMEOUT_MS)

  it('ignores an HTTP method call outside the registered route shape', () => {
    expect(routes('bare-method')).toEqual([])
  })

  it.each([
    ['missing-argument', '/api/v1/missing-argument'],
    ['inline-callable', '/api/v1/inline-callable'],
    ['declared-factory', '/api/v1/declared-factory'],
    ['indirect-factory', '/api/v1/indirect-factory'],
    ['proxy-factory', '/api/v1/proxy-factory'],
    ['proxy-handler', '/api/v1/proxy-handler'],
    ['declared-function', '/api/v1/declared-function'],
    ['declared-variable', '/api/v1/declared-variable'],
    ['class-handler', '/api/v1/class-handler'],
    ['literal-handler', '/api/v1/literal-handler'],
  ] as const)('rejects an uninspectable %s handler', (sourceId, routeTemplate) => {
    expect(() => routes(sourceId)).toThrow(
      `Cannot inspect registered route handler GET:${routeTemplate}`,
    )
  })

  it.each([
    ['method-factory', '/api/v1/method-factory'],
    ['direct-function', '/api/v1/direct-function'],
    ['nested-helper', '/api/v1/nested-helper'],
    ['bare-return', '/api/v1/bare-return'],
  ] as const)('inspects the returned handler in %s', (sourceId, routeTemplate) => {
    expect(routes(sourceId)).toMatchObject([{ method: 'GET', routeTemplate, kind: 'ordinary' }])
  })

  it('resolves imported factory and handler aliases through a real TypeScript program', () => {
    const root = mkdtempSync(join(tmpdir(), 'registered-route-alias-'))
    try {
      const shared = join(root, 'shared.ts')
      const entry = join(root, 'routes.ts')
      writeFileSync(
        shared,
        'export function wrap(handler: () => void) { return handler }\nexport const handler = () => {}',
      )
      writeFileSync(
        entry,
        `import { wrap, handler } from './shared'
        ${app}
        app.route('/api/v1/imported-factory').get(wrap(() => {}))
        app.route('/api/v1/imported-handler').get(handler)`,
      )
      const program = ts.createProgram([shared, entry], {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ESNext,
      })
      expect(ts.getPreEmitDiagnostics(program)).toEqual([])
      expect(discoverRegisteredRoutes(program, [program.getSourceFile(entry)!])).toMatchObject([
        { method: 'GET', routeTemplate: '/api/v1/imported-factory', kind: 'ordinary' },
        { method: 'GET', routeTemplate: '/api/v1/imported-handler', kind: 'ordinary' },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
