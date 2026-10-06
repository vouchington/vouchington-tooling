import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createProtocolCallbackValueResolver } from './protocol-callback-values.mts'
import { createHttpContextExtensionLookup } from './protocol-http-context-extensions.mts'

function checkedProgram(files: Record<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ESNext,
  }
  const contents = new Map(Object.entries(files).map(([name, text]) => [`/virtual/${name}`, text]))
  const host = ts.createCompilerHost(options, true)
  const getSourceFile = host.getSourceFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  const directoryExists = host.directoryExists?.bind(host)
  const readFile = host.readFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, createNew) => {
    const text = contents.get(name)
    return text === undefined
      ? getSourceFile(name, languageVersion, onError, createNew)
      : ts.createSourceFile(name, text, languageVersion, true)
  }
  host.fileExists = (name) => contents.has(name) || fileExists(name)
  host.directoryExists = (name) => name === '/virtual' || !!directoryExists?.(name)
  host.readFile = (name) => contents.get(name) ?? readFile(name)
  const program = ts.createProgram([...contents.keys()], options, host)
  expect(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
  ).toEqual([])
  return program
}

const preamble = `class Context {enabled=true;json(_value:unknown){}}
  interface Context {read():boolean}
  class Application {
    route(_path:string){}
    extend(methods:Record<string,unknown>){Object.assign(Context.prototype,methods)}
  }
  const app=new Application();const other=new Application();`

function lookup(
  setup: string,
  receiver = 'ctx',
  authenticated: boolean | 'wrong' = true,
  declarations = preamble,
  files: Record<string, string> = {},
  applicationName = 'app',
) {
  const program = checkedProgram({
    ...files,
    'route.ts': `${declarations}${setup}
    function handler(ctx:Context,otherCtx:Context){${receiver}.read()};app.route('/vote');export {};`,
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile('/virtual/route.ts')!
  let call: ts.CallExpression | undefined
  let context: ts.Symbol | undefined
  let app: ts.Symbol | undefined
  function visit(node: ts.Node) {
    if (
      (ts.isVariableDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      node.name.getText() === applicationName
    )
      app = checker.getSymbolAtLocation(node.name)
    if (ts.isParameter(node) && node.name.getText() === 'ctx')
      context = checker.getSymbolAtLocation(node.name)
    if (ts.isCallExpression(node) && node.expression.getText() === `${receiver}.read`) call = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(call).toBeDefined()
  expect(context).toBeDefined()
  expect(app).toBeDefined()
  const resolve = createHttpContextExtensionLookup(
    checker,
    program.getSourceFiles(),
    createProtocolCallbackValueResolver(checker),
    authenticated
      ? checker.getSymbolAtLocation(
          source.statements
            .filter(ts.isClassDeclaration)
            .find(
              (node) => node.name?.text === (authenticated === 'wrong' ? 'Context' : 'Application'),
            )!.name!,
        )
      : undefined,
  )
  const result = resolve(call!, context!, app!)
  expect(resolve(call!, context!, app!)).toBe(result)
  return result
}
const extension = `const extensions={read(this:Context){return this.enabled}};`

it.each([
  `${extension}app.extend(extensions)`,
  `${extension}const same=app;same.extend(extensions)`,
  `${extension}const extra={other(){}};function register(target:Application){target.extend(extensions);target.extend(extra)};register(app)`,
  `${extension}function register(target:Application){target.extend(extensions)};register(app)`,
  `${extension}function register(target:Application){target.extend(extensions)};const install=register;install(app)`,
])('resolves the actual stable application producer %s', (setup) => {
  const result = lookup(setup)
  expect(result?.node.name?.getText()).toBe('read')
  expect(result?.node.body?.getText()).toContain('this.enabled')
  expect(result?.thisParameter.getName()).toBe('this')
  expect(result?.application.getName()).toBe('app')
})

it.each([
  `${extension}other.extend(extensions)`,
  `${extension}function register(target:Application){target.extend(extensions)};register(other)`,
  `${extension}function register(target:Application){target.extend(extensions)};register(app);register(other)`,
  `${extension}extensions.read=function(this:Context){return false};app.extend(extensions)`,
  `${extension}const alias=extensions;alias.read=function(this:Context){return false};app.extend(extensions)`,
  `${extension}declare function opaque(value:unknown):void;opaque(extensions);app.extend(extensions)`,
  `${extension}declare const opaque:Record<string,unknown>;app.extend(opaque)`,
  `${extension}app.extend(extensions);app.extend(extensions)`,
  `let extensions={read(this:Context){return this.enabled}};app.extend(extensions)`,
  `const extensions={read(){return true}};app.extend(extensions)`,
  `const extensions={read(this:{enabled:boolean}){return this.enabled}};app.extend(extensions)`,
  `${extension}if(false)app.extend(extensions)`,
  `${extension}function unused(target:Application){target.extend(extensions)}`,
  `${extension}function register(target:Application){target.extend(extensions)};function unused(){register(app)}`,
  `${extension}function unused(){app.extend(extensions)}`,
  `${extension}const create=()=>app;create().extend(extensions)`,
])('rejects an unproven or unstable application producer %s', (setup) => {
  expect(lookup(setup)).toBeUndefined()
})

it('rejects a missing authenticated Application export', () => {
  expect(lookup(`${extension}app.extend(extensions)`, 'ctx', false)).toBeUndefined()
})
it('rejects an independent receiver with the same Context type', () => {
  expect(lookup(`${extension}app.extend(extensions)`, 'otherCtx')).toBeUndefined()
})

it('rejects a different authenticated class symbol', () => {
  expect(lookup(`${extension}app.extend(extensions)`, 'ctx', 'wrong')).toBeUndefined()
})

it.each([
  `${extension}app.route=(_path:string)=>{};app.extend(extensions)`,
  `${extension}app.extend(...[extensions] as [Record<string,unknown>],...[] as [])`,
  `const extensions=(()=>({read(this:Context){return this.enabled}}))();app.extend(extensions)`,
  `const extensions={get read(){return ()=>true}};app.extend(extensions)`,
  `const extensions={other(){}};app.extend(extensions)`,
  `${extension}class Installer{constructor(target:Application){target.extend(extensions)}};new Installer(app)`,
])('rejects the exact unsupported producer boundary %s', (setup) => {
  expect(lookup(setup)).toBeUndefined()
})
it('rejects a context cast that changes the selected receiver type symbol', () => {
  expect(lookup(`${extension}app.extend(extensions)`, '(ctx as {read():boolean})')).toBeUndefined()
})
it('rejects a route and extension declared on different classes', () => {
  const declarations = preamble
    .replace(
      'class Application {',
      'class Base{route(_path:string){}};class Application extends Base{',
    )
    .replace('route(_path:string){}\n    extend', 'extend')
  expect(lookup(`${extension}app.extend(extensions)`, 'ctx', true, declarations)).toBeUndefined()
})
it('rejects an actual type-only symbol as the application', () => {
  expect(
    lookup(
      `${extension}interface OnlyType{};app.extend(extensions)`,
      'ctx',
      true,
      preamble,
      {},
      'OnlyType',
    ),
  ).toBeUndefined()
})
it('rejects duplicate method producers accepted by an unchecked JavaScript compiler', () => {
  expect(
    lookup(
      `import {extensions} from './extensions.js';app.extend(extensions)`,
      'ctx',
      true,
      preamble,
      {
        'extensions.js': `export const extensions={read(){return true},read(){return false}};`,
      },
    ),
  ).toBeUndefined()
})

it('rejects an opaque any-typed member with no compiler property symbol', () => {
  expect(lookup(`${extension}app.extend(extensions)`, '(ctx as any)')).toBeUndefined()
})
