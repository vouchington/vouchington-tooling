import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { enclosingFunction } from './protocol-marker-analysis.mts'
import { isSupportedProtocolCallback } from './protocol-callback-invocation.mts'
import {
  createProtocolCallbackValueResolver,
  type CallbackValue,
} from './protocol-callback-values.mts'

function check(
  source: string,
  shared = '',
  inspect?: (checker: ts.TypeChecker, source: ts.SourceFile) => void,
) {
  const root = mkdtempSync(join(tmpdir(), 'protocol-callback-invocation-'))
  try {
    const file = join(root, 'routes.ts')
    const helper = join(root, 'helper.ts')
    writeFileSync(helper, shared)
    writeFileSync(
      file,
      `declare function mark(name: string): void;
      declare const app: {route(path: string): {get(handler: (ctx: unknown) => unknown): void}};
      ${source}`,
    )
    const program = ts.createProgram([file, helper], {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    })
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    ).toEqual([])
    const output: Record<string, boolean> = {}
    const checker = program.getTypeChecker()
    inspect?.(checker, program.getSourceFile(file)!)
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'mark' &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const fn = enclosingFunction(node)
        if (!fn) throw new Error('Fixture marker is outside a callback')
        output[node.arguments[0].text] = isSupportedProtocolCallback(fn, checker)
      }
      ts.forEachChild(node, visit)
    }
    visit(program.getSourceFile(file)!)
    return output
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('protocol callback invocation proof', () => {
  it('accepts inline route handlers, immediate invocation and concrete callback consumers', () => {
    expect(
      check(`
      function consume(cb: () => void) { cb() }
      function options(value: {emit: () => void}) { const {emit} = value; emit() }
      function forward(value: {emit: () => void}) { options(value) }
      function alias(cb: () => void) { const call = cb; call() }
      app.route('/inline').get(ctx => mark('route'));
      (() => mark('immediate'))();
      consume(() => mark('parameter'));
      options({emit: () => mark('destructure')});
      forward({emit: () => mark('forward')});
      alias(() => mark('alias'));
    `),
    ).toEqual({
      route: true,
      immediate: true,
      parameter: true,
      destructure: true,
      forward: true,
      alias: true,
    })
  })

  it('rejects callbacks whose option bindings escape to opaque mutators before invocation', () => {
    expect(
      check(`
      declare function mutate(value: {emit:()=>void}):void;
      function consume(options:{emit:()=>void}){mutate(options);options.emit()}
      function aliased(options:{emit:()=>void}){const value=options;mutate(value);options.emit()}
      function clean(options:{emit:()=>void}){mutate({emit:()=>{}});options.emit()}
      const emit=()=>mark('opaque-shorthand');consume({emit});
      consume({emit(){mark('opaque-method')}});
      consume({emit:()=>mark('opaque')});
      aliased({emit:()=>mark('opaque-alias')});
      clean({emit:()=>mark('clean')});
    `),
    ).toEqual({
      opaque: false,
      'opaque-alias': false,
      'opaque-shorthand': false,
      'opaque-method': false,
      clean: true,
    })
  })

  it('requires registered factory callbacks to execute from the returned request handler', () => {
    expect(
      check(`
      function setup(cb:()=>void){cb();return(ctx:unknown)=>undefined}
      function request(cb:()=>void){return(ctx:unknown)=>cb()}
      function both(cb:()=>void){cb();return(ctx:unknown)=>cb()}
      function setupReturned(cb:()=>()=>void){return cb()}
      app.route('/setup').get(setup(()=>mark('setup-only')));
      app.route('/request').get(request(()=>mark('request-only')));
      app.route('/both').get(both(()=>mark('both')));
      app.route('/setup-returned').get(setupReturned(()=>{mark('setup-returned');return()=>{}}));
    `),
    ).toEqual({ 'setup-only': false, 'request-only': true, both: true, 'setup-returned': false })
  })

  it('resolves imported helper aliases and executable forwarding wrappers', () => {
    expect(
      check(
        `
      import {consume as run} from './helper';
      function forward(options: {emit: () => void}) {
        run(() => options.emit());
      }
      forward({emit: () => mark('wrapper')});
      run(() => mark('import'));
    `,
        'export function consume(callback: () => void) { callback() }',
      ),
    ).toEqual({ wrapper: true, import: true })
  })

  it('proves the real pipe/factory shapes through a returned registered handler', () => {
    expect(
      check(`
      function pipeChannelToSSE(options: {emit: (event: {event: 'status'; data: number}) => void}) {
        const {emit} = options;
        emit({event: 'status', data: 1});
      }
      function createAdminSnapshotStream(options: {emit: (stream: unknown, event: {event: 'status'; data: number}) => void}) {
        return async (ctx: unknown) => {
          const stream = {};
          await pipeChannelToSSE({emit: event => options.emit(stream, event)});
        };
      }
      app.route('/factory').get(createAdminSnapshotStream({emit: (stream, event) => mark('factory')}));
      pipeChannelToSSE({emit: event => mark('pipe')});
    `),
    ).toEqual({ factory: true, pipe: true })
  })

  it('rejects ignored, declaration-only, deferred and unreachable callback invocations', () => {
    expect(
      check(`
      function ignore(cb: () => void) {}
      declare function unknown(cb: () => void): void;
      function deferred(cb: () => void) { const unused = () => cb() }
      function unusedOptions(options: {emit: () => void}) { return () => options.emit() }
      function dead(cb: () => void) { if (false) cb() }
      function afterReturn(cb: () => void) { return; cb() }
      function generator(cb: () => void) { return function* () { cb() } }
      ignore(() => mark('ignored'));
      unknown(() => mark('declared'));
      deferred(() => mark('deferred'));
      unusedOptions({emit: () => mark('unused-return')});
      dead(() => mark('dead'));
      afterReturn(() => mark('after-return'));
      generator(() => mark('generator'));
    `),
    ).toEqual({
      ignored: false,
      declared: false,
      deferred: false,
      'unused-return': false,
      dead: false,
      'after-return': false,
      generator: false,
    })
  })

  it('terminates cyclic helper forwarding without inventing an invocation', () => {
    expect(
      check(`
      function first(cb: () => void) { second(cb) }
      function second(cb: () => void) { first(cb) }
      first(() => mark('cycle'));
    `),
    ).toEqual({ cycle: false })
  })

  it('does not infer callback execution from type signatures or arbitrary get methods', () => {
    expect(
      check(`
      declare const object: {get(cb: () => void): void};
      declare const typed: {emit: (options: {emit: () => void}) => void};
      object.get(() => mark('arbitrary-get'));
      typed.emit({emit: () => mark('typed-property')});
    `),
    ).toEqual({ 'arbitrary-get': false, 'typed-property': false })
  })

  it('rejects replaced callback parameters, properties and mutable aliases', () => {
    expect(
      check(`
      function replaced(cb: () => void) { cb = () => {}; cb() }
      function property(options: {emit: () => void}) { options.emit = () => {}; options.emit() }
      function alias(options: {emit: () => void}) { const saved = options; saved.emit = () => {}; saved.emit() }
      function removed(options: {emit?: () => void}) { delete options.emit; (options.emit as (() => void) | undefined)?.() }
      function mutable(cb: () => void) { let saved = cb; saved() }
      replaced(() => mark('replaced'));
      property({emit: () => mark('property')});
      alias({emit: () => mark('alias')});
      removed({emit: () => mark('removed')});
      mutable(() => mark('mutable'));
    `),
    ).toEqual({ replaced: false, property: false, alias: false, removed: false, mutable: false })
  })

  it('executes called local closures while ignoring uncaptured deferred closures', () => {
    expect(
      check(`
      function called(cb: () => void) { const run = () => cb(); run() }
      function immediate(cb: () => void) { (() => cb())() }
      function factory(options: {emit: () => void}) { return () => options.emit() }
      function forwarded(options: {emit: () => void}) { return factory(options) }
      called(() => mark('called-local'));
      immediate(() => mark('called-iife'));
      app.route('/forwarded').get(forwarded({emit: () => mark('forwarded-factory')}));
    `),
    ).toEqual({ 'called-local': true, 'called-iife': true, 'forwarded-factory': true })
  })

  it('supports const callbacks consumed in executed source statements without scanning deferred functions', () => {
    expect(
      check(`
      function consume(cb: () => void) { cb() }
      const handler = (ctx: unknown) => mark('named-handler');
      const callback = () => mark('named-callback');
      const deferred = () => mark('named-deferred');
      const dead = () => mark('named-dead');
      app.route('/named').get(handler);
      consume(callback);
      function unused() { consume(deferred) }
      if (false) consume(dead);
    `),
    ).toEqual({
      'named-handler': true,
      'named-callback': true,
      'named-deferred': false,
      'named-dead': false,
    })
  })

  it('inspects proven inline route bodies for named emitters while excluding deferred calls', () => {
    expect(
      check(`
      function emit() { mark('route-emitter') }
      function ignored() { mark('ignored-emitter') }
      function dead() { mark('dead-emitter') }
      app.route('/events').get(() => emit());
      app.route('/unused').get(() => { function unused() { ignored() } });
      app.route('/dead').get(() => { if (false) dead() });
    `),
    ).toEqual({ 'route-emitter': true, 'ignored-emitter': false, 'dead-emitter': false })
  })

  it('resolves shorthand and literal method callbacks through implemented option consumers', () => {
    expect(
      check(`
      function consume(options: {emit: () => void}) { const {emit: send} = options; send() }
      const emit = () => mark('shorthand');
      consume({emit});
      consume({emit() { mark('method') }});
      consume({'emit': () => mark('literal')});
    `),
    ).toEqual({ shorthand: true, method: true, literal: true })
  })

  it('rejects standalone functions, generators and callback arguments in dead statements', () => {
    expect(
      check(`
      function consume(cb: () => void) { cb() }
      function standalone() { mark('standalone') }
      function* deferredGenerator() { mark('direct-generator') }
      if (false) consume(() => mark('dead-argument'));
      const object = {emit: () => mark('unregistered-object')};
    `),
    ).toEqual({
      standalone: false,
      'direct-generator': false,
      'dead-argument': false,
      'unregistered-object': false,
    })
  })

  it('rejects reassigned implemented helpers and computed callback access', () => {
    expect(
      check(`
      function invoke(cb: () => void) { cb() }
      function ignore(cb: () => void) {}
      function computed(options: {emit: () => void}) { options['emit']() }
      function unresolved(options: any) { options.missing() }
      // @ts-expect-error runtime helper replacement must fail closed
      invoke = ignore;
      invoke(() => mark('rewritten-helper'));
      computed({emit: () => mark('computed')});
      unresolved({emit: () => mark('unresolved')});
    `),
    ).toEqual({ 'rewritten-helper': false, computed: false, unresolved: false })
  })

  it('terminates cyclic forwarded value bindings instead of claiming callback invocation', () => {
    expect(
      check(
        `function standalone(callback: () => void) { mark('unused') }`,
        '',
        (checker, source) => {
          const fn = source.statements.find(
            (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'standalone',
          ) as ts.FunctionDeclaration
          const name = fn.parameters[0]!.name
          const symbol = checker.getSymbolAtLocation(name)!
          const env = new Map<ts.Symbol, CallbackValue>()
          env.set(symbol, { node: name, env })
          const resolver = createProtocolCallbackValueResolver(checker)
          expect(resolver.resolve(name, env)).toBeUndefined()
          expect(resolver.resolve(name, new Map(), new Set([fn.parameters[0]!]))).toBeUndefined()
        },
      ),
    ).toEqual({ unused: false })
  })

  it('propagates forwarded callback replacement and invokes only called local helpers', () => {
    expect(
      check(`
      function replace(options: {emit: () => void}) { options.emit = () => {} }
      function mutateAlias(options: {emit: () => void}) { const saved=options; saved.emit=()=>{} }
      function consume(options: {emit: () => void}) { replace(options); options.emit() }
      function alias(options: {emit: () => void}) { mutateAlias(options); options.emit() }
      consume({emit: () => mark('replaced-forward')});
      alias({emit: () => mark('alias-forward')});
      app.route('/called').get(ctx=>{function called(){mark('called')}called()});
      app.route('/unused').get(ctx=>{function ignored(){mark('ignored-local')}});
    `),
    ).toEqual({
      'replaced-forward': false,
      'alias-forward': false,
      called: true,
      'ignored-local': false,
    })
  })

  it('fails closed on unresolved, numeric, and destructured callback bindings', () => {
    expect(
      check(`
      function options(value:{emit:()=>void}){value.emit()}
      function numeric(value:{0:()=>void}){const {0:emit}=value;emit()}
      function parameter({emit}:{emit:()=>void}){emit()}
      function array(value:(()=>void)[]){const [emit]=value;emit()}
      numeric({0:()=>mark('numeric')});
      parameter({emit:()=>mark('parameter-pattern')});
      array([()=>mark('array-pattern')]);
      // @ts-expect-error unresolved shorthand callback must not prove invocation
      options({emit});
      // @ts-expect-error unresolved callee must not prove invocation
      missing(()=>mark('unresolved'));
    `),
    ).toEqual({
      numeric: false,
      'parameter-pattern': false,
      'array-pattern': false,
      unresolved: false,
    })
  })

  it('returns no callback value for an unresolved shorthand or a declaration node', () => {
    expect(
      check(
        `
      // @ts-expect-error unresolved callback shorthand must fail closed
      const options={missing};
      const result=options.missing;
    `,
        '',
        (checker, source) => {
          const statement = source.statements.find(
            (node) =>
              ts.isVariableStatement(node) &&
              node.declarationList.declarations.some(
                (declaration) =>
                  ts.isIdentifier(declaration.name) && declaration.name.text === 'result',
              ),
          ) as ts.VariableStatement
          const declaration = statement.declarationList.declarations[0]!
          const resolver = createProtocolCallbackValueResolver(checker)
          expect(resolver.resolve(declaration.initializer!, new Map())).toBeUndefined()
          expect(resolver.resolve(declaration, new Map())).toBeUndefined()
        },
      ),
    ).toEqual({})
  })

  it('proves a callback while skipping omitted optional and spread rest arguments', () => {
    expect(
      check(`
      function optional(callback:()=>void,unused?:()=>void){callback()}
      function rest(callback:()=>void,...unused:unknown[]){callback()}
      optional(()=>mark('optional'));
      rest(()=>mark('rest'),...[]);
    `),
    ).toEqual({ optional: true, rest: true })
  })
})
