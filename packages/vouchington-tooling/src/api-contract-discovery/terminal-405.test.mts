import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import ts from '../contract-schema/typescript-api.mts'
import { discoverRegisteredRoutes } from './registered-route-catalog.mts'
import { handlerNodes } from './registered-route-handler-analysis.mts'
import { isTerminal405Handler } from './registered-route-terminal-error.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app: any
  interface Ctx { throw(status: number): never; json(body: unknown): void; set(name:string,value:string):void }
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
  allow: handler("ctx.set('Allow','GET, PATCH'); ctx.throw(405)"),
  'closure-wrapper': `${preamble} const deny=(ctx:Ctx)=>ctx.throw(405)
    const wrap=(handler:(ctx:Ctx)=>void)=>(ctx:Ctx)=>handler(ctx);app.route('/api/example').get(wrap(deny))`,
  'closure-arrow-argument': `${preamble} const wrap=(handler:(ctx:Ctx)=>void)=>(ctx:Ctx)=>handler(ctx)
    app.route('/api/example').get(wrap((ctx:Ctx)=>ctx.throw(405)))`,
  'unresolved-factory-return': `${preamble} const deny=(ctx:Ctx)=>ctx.throw(405)
    const handlers={success:(ctx:Ctx)=>ctx.json({ok:true})};function choose(flag:boolean){if(flag)return deny;return handlers.success}
    app.route('/api/example').get(choose(false))`,
  'fallthrough-factory': `${preamble} const deny=(ctx:Ctx)=>ctx.throw(405)
    function choose(flag:boolean){if(flag)return deny};app.route('/api/example').get(choose(false))`,
  'mutable-factory': `${preamble} const deny=(ctx:Ctx)=>ctx.throw(405);let choose=()=>deny;app.route('/api/example').get(choose())`,
  'generator-factory': `${preamble} const deny=(ctx:Ctx)=>ctx.throw(405);function* wrap(){return deny};app.route('/api/example').get(wrap())`,
  'async-factory': `${preamble} const deny=(ctx:Ctx)=>ctx.throw(405);async function wrap(){return deny};app.route('/api/example').get(wrap())`,
  'bare-return-factory': `${preamble} const deny=(ctx:Ctx)=>ctx.throw(405)
    function choose(flag:boolean){if(flag)return deny;return};app.route('/api/example').get(choose(false))`,
  'branch-closures-success': `${preamble} const deny=(ctx:Ctx)=>ctx.throw(405)
    const success=(ctx:Ctx)=>ctx.json({ok:true});const wrap=(handler:(ctx:Ctx)=>void)=>(ctx:Ctx)=>handler(ctx)
    function choose(flag:boolean){if(flag)return wrap(deny);return wrap(success)};app.route('/api/example').get(choose(false))`,
  'all-branches-factory': `${preamble} const deny=(ctx:Ctx)=>ctx.throw(405)
    function choose(flag:boolean){if(flag)return deny;else return (ctx:Ctx)=>ctx.throw(405)};app.route('/api/example').get(choose(false))`,
  'nested-wrapper': `${preamble} const reject=(ctx:Ctx)=>ctx.throw(405)
    const wrap=<T>(handler:T):T=>handler;app.route('/api/example').get(wrap(wrap(reject)))`,
  transparent: `${preamble} type Handler=(ctx:Ctx)=>never
    const reject=(((ctx:Ctx)=>ctx.throw(405)) satisfies Handler) as Handler
    app.route('/api/example').get((reject))`,
  'generator-helper': `${preamble} function* reject(ctx:Ctx){ctx.throw(405)}
    app.route('/api/example').get((ctx:Ctx)=>{reject(ctx)})`,
  'async-generator-helper': `${preamble} async function* reject(ctx:Ctx){ctx.throw(405)}
    app.route('/api/example').get((ctx:Ctx)=>reject(ctx))`,
  'optional-throw': `${preamble} app.route('/api/example').get((ctx:{throw?:(status:number)=>never})=>ctx.throw?.(405))`,
  'optional-context': `${preamble} app.route('/api/example').get((ctx:Ctx|undefined)=>ctx?.throw(405))`,
  'void-adapter': `${preamble} async function deny(ctx:Ctx){ctx.throw(405)}
    const adapter:(ctx:Ctx)=>void=(ctx)=>deny(ctx);app.route('/api/example').get((ctx:Ctx)=>{adapter(ctx)})`,
  'void-adapter-awaited': `${preamble} async function deny(ctx:Ctx){ctx.throw(405)}
    const adapter:(ctx:Ctx)=>void=(ctx)=>deny(ctx);app.route('/api/example').get(async(ctx:Ctx)=>{await adapter(ctx)})`,
  'void-adapter-returned': `${preamble} async function deny(ctx:Ctx){ctx.throw(405)}
    const adapter:(ctx:Ctx)=>void=(ctx)=>deny(ctx);app.route('/api/example').get((ctx:Ctx)=>adapter(ctx))`,
  'destructured-wrapper': `${preamble} function wrap({unused}:{unused:string}){return(ctx:Ctx)=>ctx.throw(405)}
    app.route('/api/example').get(wrap({unused:''}))`,
  'rewritten-wrapper': `${preamble} type Handler=(ctx:Ctx)=>void
    const reject=(ctx:Ctx)=>ctx.throw(405);function wrap(handler:Handler){handler=(ctx)=>ctx.json({ok:true});return handler}
    app.route('/api/example').get(wrap(reject))`,
  'postfix-write': `${preamble} function reject(ctx:Ctx){ctx.throw(405)}
    (reject as any)++;app.route('/api/example').get((ctx:Ctx)=>reject(ctx))`,
  'prefix-write': `${preamble} function reject(ctx:Ctx){ctx.throw(405)}
    --(reject as any);app.route('/api/example').get((ctx:Ctx)=>reject(ctx))`,
  'unary-read': `${preamble} function reject(ctx:Ctx){ctx.throw(405)}
    const value=+(reject as any);app.route('/api/example').get((ctx:Ctx)=>reject(ctx))`,
  'computed-helper': `${preamble} function make(ctx:Ctx) {ctx.json({ok:true});return {reject(context:Ctx){context.throw(405)}}}
    app.route('/api/example').get((ctx:Ctx)=>make(ctx).reject(ctx))`,
  'mutable-helper': `${preamble} let reject:(ctx:Ctx)=>void=(ctx)=>ctx.throw(405)
    reject=(ctx)=>ctx.json({ok:true});app.route('/api/example').get((ctx:Ctx)=>reject(ctx))`,
  'mutable-middleware': `${preamble} let middleware:(ctx:Ctx)=>void=(ctx)=>ctx.json({ok:true})
    const reject=(ctx:Ctx)=>ctx.throw(405);app.route('/api/example').get(middleware,reject)`,
  'loop-write': `${preamble} function reject(ctx:Ctx):void {ctx.throw(405)}
    // @ts-expect-error Intentional loop assignment to a declaration binding.
    for(reject of [(ctx:Ctx)=>ctx.json({ok:true})]) {}
    app.route('/api/example').get((ctx:Ctx)=>reject(ctx))`,
  'mutable-direct': `${preamble} let handler:(ctx:Ctx)=>void=(ctx)=>ctx.throw(405)
    handler=(ctx)=>ctx.json({ok:true});app.route('/api/example').get(handler)`,
  'rewritten-function': `${preamble} function reject(ctx:Ctx):void {ctx.throw(405)}
    // @ts-expect-error Intentional runtime overwrite of a declaration binding.
    reject=(ctx:Ctx)=>ctx.json({ok:true});app.route('/api/example').get((ctx:Ctx)=>reject(ctx))`,
  'destructured-write': `${preamble} function reject(ctx:Ctx):void {ctx.throw(405)}
    // @ts-expect-error Intentional destructured runtime overwrite of a declaration binding.
    [reject]=[(ctx:Ctx)=>ctx.json({ok:true})];app.route('/api/example').get((ctx:Ctx)=>reject(ctx))`,
  'virtual-method': `${preamble} class Base {reject(ctx:Ctx):void{ctx.throw(405)}}
    class Child extends Base {override reject(ctx:Ctx){ctx.json({ok:true})}}
    const receiver:Base=new Child();app.route('/api/example').get((ctx:Ctx)=>receiver.reject(ctx))`,
  'erased-async': `${preamble} const reject:(ctx:Ctx)=>void=async(ctx)=>{ctx.throw(405)}
    app.route('/api/example').get((ctx:Ctx)=>{reject(ctx)})`,
  'dynamic-header': handler("ctx.set('Allow',condition ? 'POST' : 'GET'); ctx.throw(405)"),
  'other-header-context': handler("other.set('Allow','POST'); ctx.throw(405)"),
  'invalid-header-value': handler("ctx.set('Allow','POST\\r\\nInjected: true'); ctx.throw(405)"),
  'unrecognized-header': handler("ctx.set('Content-Type','application/json'); ctx.throw(405)"),
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
  'recursive-wrapper': `${preamble} const reject=(ctx:Ctx)=>ctx.throw(405)
    const wrap=<T>(handler:T):T=>wrap(handler);app.route('/api/example').get(wrap(reject))`,
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
    'closure-wrapper',
    'closure-arrow-argument',
    'all-branches-factory',
    'awaited',
    'parenthesized',
    'defaults',
    'allow',
    'nested-wrapper',
    'transparent',
    'void-adapter-awaited',
    'void-adapter-returned',
    'unary-read',
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
    'dynamic-header',
    'other-header-context',
    'invalid-header-value',
    'unrecognized-header',
    'computed-helper',
    'mutable-helper',
    'mutable-direct',
    'mutable-middleware',
    'loop-write',
    'rewritten-function',
    'destructured-write',
    'virtual-method',
    'erased-async',
    'void-adapter',
    'unresolved-factory-return',
    'fallthrough-factory',
    'bare-return-factory',
    'mutable-factory',
    'generator-factory',
    'async-factory',
    'branch-closures-success',
    'rewritten-wrapper',
    'destructured-wrapper',
    'postfix-write',
    'prefix-write',
    'generator-helper',
    'async-generator-helper',
    'optional-throw',
    'optional-context',
  ] as const)('keeps %s outside error-only classification', (name) => {
    expect(discoverRegisteredRoutes(matrix.program, [matrix.sourceFile(name)])).toMatchObject([
      { kind: 'ordinary' },
    ])
  })

  it('terminates a self-referential compiler parameter binding', () => {
    const source = matrix.sourceFile('recursive-wrapper')
    const declaration = source.statements.find(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations[0]?.name.getText() === 'wrap',
    ) as ts.VariableStatement
    const factory = declaration.declarationList.declarations[0]!.initializer as ts.ArrowFunction
    const parameter = factory.parameters[0]!.name as ts.Identifier
    const checker = matrix.program.getTypeChecker()
    expect(
      handlerNodes(
        parameter,
        checker,
        new Map([[checker.getSymbolAtLocation(parameter)!, parameter]]),
      ),
    ).toEqual([])
  })

  it('rejects a source module rather than treating it as an executable handler', () => {
    expect(isTerminal405Handler(matrix.sourceFile('direct'), matrix.program.getTypeChecker())).toBe(
      false,
    )
  })

  it.each(['recursive-factory', 'recursive-wrapper'] as const)(
    'fails closed through %s',
    (name) => {
      expect(() => discoverRegisteredRoutes(matrix.program, [matrix.sourceFile(name)])).toThrow(
        'Cannot inspect registered route handler GET:/api/example',
      )
    },
  )

  it('resolves imported renamed helper and factory declarations with the compiler', () => {
    const root = mkdtempSync(join(tmpdir(), 'terminal-405-'))
    try {
      const shared = join(root, 'shared.ts')
      const entry = join(root, 'routes.ts')
      writeFileSync(
        shared,
        `export interface Ctx { throw(status: number): never }
        export function reject(context: Ctx) { context.throw(405) }
        export const wrap = <T>(handler: T): T => handler
        export const closure = (handler: (ctx: Ctx) => void) => (ctx: Ctx) => handler(ctx)
        export default function(context: Ctx) { context.throw(405) }`,
      )
      writeFileSync(
        entry,
        `import defaultDeny, { reject as deny, wrap as handlerFactory, closure as delegateFactory, type Ctx } from './shared'
        declare const app: any
        app.route('/api/example').get(handlerFactory((ctx: Ctx) => deny(ctx)))
        app.route('/api/default').get(defaultDeny)
        app.route('/api/closure').get(delegateFactory(deny))`,
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
        { kind: 'error-only' },
        { kind: 'error-only' },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
