import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import ts from '../contract-schema/typescript-api.mts'
import { discoverRegisteredRoutes } from './registered-route-catalog.mts'
import { isTerminal405Handler } from './registered-route-terminal-error.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app: any
  interface Ctx { throw(status: number): never; json(body: unknown): void }
  declare const condition: boolean
  declare const status: number
  declare const other: Ctx;`
const handler = (body: string) => `${preamble}
  app.route('/api/example').get((ctx: Ctx) => { ${body} })`
const sources = {
  direct: handler('ctx.throw(405)'),
  renamed: `${preamble} app.route('/api/example').get((context: Ctx) => context.throw(405))`,
  helper: `${preamble}
    function reject(context: Ctx) { context.throw(405) }
    function handler(context: Ctx) { return reject(context) }
    app.route('/api/example').get(handler)`,
  wrapper: `${preamble}
    const reject = (context: Ctx) => context.throw(405)
    const wrap = <T>(handler: T): T => handler
    app.route('/api/example').get(wrap(reject))`,
  awaited: `${preamble} async function reject(context: Ctx) { context.throw(405) }
    app.route('/api/example').get(async (ctx: Ctx) => { await reject(ctx) })`,
  parenthesized: handler("; 'directive'; const code = 405; return (ctx.throw(405))"),
  defaults: `${preamble} function reject(context: Ctx, reason = 'unsupported') { context.throw(405) }
    app.route('/api/example').get((ctx: Ctx) => reject(ctx))`,
  empty: handler(''),
  'bare-return': handler('return'),
  'non-call': handler('return 405'),
  'external-helper': `${preamble} declare function reject(context: Ctx): never;
    app.route('/api/example').get((ctx: Ctx) => reject(ctx))`,
  'unbound-helper': `${preamble} function reject(context: Ctx) { context.throw(405) }
    app.route('/api/example').get((ctx: Ctx) => reject(other))`,
  'no-context': `${preamble} app.route('/api/example').get(() => other.throw(405))`,
  'destructured-context': `${preamble} app.route('/api/example').get(({throw: reject}: Ctx) => reject(405))`,
  conditional: handler('if (condition) ctx.throw(405)'),
  caught: handler('try { ctx.throw(405) } catch {}'),
  fallthrough: handler('if (condition) return; ctx.throw(405)'),
  emission: handler('ctx.json({ ok: true }); ctx.throw(405)'),
  nested: handler('const callback = () => ctx.throw(405); return callback'),
  dynamic: handler('ctx.throw(status)'),
  unrelated: handler('other.throw(405)'),
  recursive: `${preamble} function reject(context: Ctx): never { return reject(context) }
    app.route('/api/example').get((ctx: Ctx) => reject(ctx))`,
  'helper-conditional': `${preamble} function reject(context: Ctx) {
    if (condition) context.throw(405)
  } app.route('/api/example').get((ctx: Ctx) => reject(ctx))`,
  'unawaited-helper': `${preamble} async function reject(context: Ctx) { context.throw(405) }
    app.route('/api/example').get((ctx: Ctx) => { reject(ctx) })`,
  'argument-emission': `${preamble} function reject(context: Ctx, unused: void) {
    context.throw(405)
  } app.route('/api/example').get((ctx: Ctx) => reject(ctx, ctx.json({ ok: true })))`,
  destructuring: `${preamble} declare function sideEffect(): 0
    app.route('/api/example').get((ctx: Ctx) => {
      const { [sideEffect()]: value } = 'x'; ctx.throw(405)
    })`,
  'parameter-destructuring': `${preamble} declare function sideEffect(): 0
    function reject(context: Ctx, { [sideEffect()]: value }: string = 'x') { context.throw(405) }
    app.route('/api/example').get((ctx: Ctx) => reject(ctx))`,
  'recursive-factory': `${preamble} function factory(): (ctx: Ctx) => never { return factory() }
    app.route('/api/example').get(factory())`,
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>

describe('terminal error-only route proof', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })

  it.each([
    'direct',
    'renamed',
    'helper',
    'wrapper',
    'awaited',
    'parenthesized',
    'defaults',
  ] as const)('proves the handler context terminates with 405 in %s', (name) => {
    expect(discoverRegisteredRoutes(matrix.program, [matrix.sourceFile(name)])).toMatchObject([
      { kind: 'error-only' },
    ])
  })

  it.each([
    'conditional',
    'caught',
    'fallthrough',
    'emission',
    'nested',
    'dynamic',
    'unrelated',
    'recursive',
    'helper-conditional',
    'unawaited-helper',
    'argument-emission',
    'destructuring',
    'parameter-destructuring',
    'empty',
    'bare-return',
    'non-call',
    'external-helper',
    'unbound-helper',
    'no-context',
    'destructured-context',
  ] as const)('keeps %s outside error-only classification', (name) => {
    expect(discoverRegisteredRoutes(matrix.program, [matrix.sourceFile(name)])).toMatchObject([
      { kind: 'ordinary' },
    ])
  })

  it('rejects a source module rather than treating it as an executable handler', () => {
    expect(isTerminal405Handler(matrix.sourceFile('direct'), matrix.program.getTypeChecker())).toBe(
      false,
    )
  })

  it('fails closed without recursing forever through a factory cycle', () => {
    expect(() =>
      discoverRegisteredRoutes(matrix.program, [matrix.sourceFile('recursive-factory')]),
    ).toThrow('Cannot inspect registered route handler GET:/api/example')
  })

  it('resolves imported renamed helper and factory declarations with the compiler', () => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-405-'))
    try {
      const shared = join(root, 'shared.ts')
      const entry = join(root, 'routes.ts')
      writeFileSync(
        shared,
        `export interface Ctx { throw(status: number): never }
        export function reject(context: Ctx) { context.throw(405) }
        export const wrap = <T>(handler: T): T => handler`,
      )
      writeFileSync(
        entry,
        `import { reject as deny, wrap as handlerFactory, type Ctx } from './shared'
        declare const app: any
        app.route('/api/example').get(handlerFactory((ctx: Ctx) => deny(ctx)))`,
      )
      const program = ts.createProgram([shared, entry], {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      })
      expect(ts.getPreEmitDiagnostics(program)).toEqual([])
      expect(discoverRegisteredRoutes(program, [program.getSourceFile(entry)!])).toMatchObject([
        { kind: 'error-only' },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
