import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createContextConsumerSources } from './protocol-http-context-consumer-sources.mts'
import { createContextValueStability } from './protocol-http-context-value-stability.mts'
import { createContextReceiverGuard } from './protocol-http-context-receiver.mts'
import { createHttpContextValueResolver } from './protocol-http-context-values.mts'
import { opaqueHttpContextArgument } from './protocol-http-context-escapes.mts'
import { contextWriteTargets } from './protocol-http-context-write-targets.mts'
import { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import { createLiteralWrapperIndex } from './protocol-http-context-literal-wrappers.mts'
import { contextForwardedTarget } from './protocol-http-context-forwarded-target.mts'

const files = {
  'exported.ts': `export const options={assertAccess:(ctx:any)=>ctx.assert(true)};`,
  'cycle-a.ts': `import {touch} from './cycle-b.js';
    export const options={assertAccess:(ctx:any)=>ctx.assert(true)};
    export const fromB=touch;`,
  'cycle-b.ts': `import {options} from './cycle-a.js';export const touch=options;`,
  'targets.ts': `let shorthand=0;let field={value:0};let rest:Record<string,number>={};
    let first=0;let tail:number[]=[];
    ({shorthand}={shorthand:1});
    ({value:field.value,...rest}={value:2,other:3});
    [,first=0,...tail]=[9,2,3];
    export {};`,
  'unstable.ts': `const options={assertAccess:(ctx:any)=>ctx.assert(true)};
    options.assertAccess=(ctx:any)=>ctx.assert(false);export {};`,
  'direct-call.ts': `function direct(){return 1}direct();export {};`,
  'method-this.ts': `declare const app:any;
    declare function apiNoContent(key:string):void;
    declare function opaque(ctx:any):void;
    const options={assertAccess:function(ctx:any){this.assertAccess=opaque;ctx.setStatus(204)}};
    app.route('/vote').put((ctx:any)=>{
      apiNoContent('PUT:/vote');options.assertAccess(ctx)});
    export {};`,
  'inline-method-this.ts': `declare const app:any;
    declare function apiNoContent(key:string):void;
    declare function opaque(ctx:any):void;
    app.route('/vote').put((ctx:any)=>{
      apiNoContent('PUT:/vote');
      ({inspect(ctx:any){this.inspect=opaque;ctx.setStatus(204)}}).inspect(ctx)});
    export {};`,
  'repeat-return.ts': `declare const choose:boolean;
    function expose(options:{callback:(ctx:any)=>void}){
      if(choose)return options;return options}
    export {expose};`,
  'spread-forward.ts': `function forward(value:any,...other:any[]){}
    const rest:any[]=[];const options={callback:(ctx:any)=>ctx.assert(true)};
    forward(options,...rest);const result=options.callback;export {};`,
  'alias-roots.ts': `import * as barrel from './barrel.js';
    import {options as importedOptions} from './exported.js';
    const fromModule=barrel['options'];const fromProperty=importedOptions.assertAccess;
    export {fromModule,fromProperty};`,
  'barrel.ts': `export {options} from './exported.js';`,
  'export-alias.ts': `const options={callback:(ctx:any)=>ctx.assert(true)};
    export {options as alias};`,
  'destructured-capture.ts': `const original={selected:{value:1}};
    const {selected}=original;export function expose(){return selected}`,
  'class-capture.ts': `class External{};export function expose(){return External}`,
  'non-writable-members.ts': `const object={get value(){return 1},method(){return 2}};
    export {object};`,
} as const
type FileName = keyof typeof files
let program: ts.Program
let uncheckedProgram: ts.Program
let uncheckedSource: ts.SourceFile

function source(name: FileName): ts.SourceFile {
  const file = program.getSourceFile(`/virtual/${name}`)
  if (!file) throw new Error(`Missing ${name}`)
  return file
}

function assignments(name: FileName): ts.BinaryExpression[] {
  const rows: ts.BinaryExpression[] = []
  for (const statement of source(name).statements) {
    if (!ts.isExpressionStatement(statement)) continue
    const expression = ts.isParenthesizedExpression(statement.expression)
      ? statement.expression.expression
      : statement.expression
    if (ts.isBinaryExpression(expression)) rows.push(expression)
  }
  return rows
}

describe('HTTP consumer proof covers exported and destructured bindings', () => {
  beforeAll(() => {
    const options: ts.CompilerOptions = {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ESNext,
    }
    const host = ts.createCompilerHost(options, true)
    const contents = new Map(
      Object.entries(files).map(([name, text]) => [`/virtual/${name}`, text]),
    )
    const readSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (name, languageVersion, onError, createNew) => {
      const content = contents.get(name)
      return content === undefined
        ? readSourceFile(name, languageVersion, onError, createNew)
        : ts.createSourceFile(name, content, languageVersion, true, ts.ScriptKind.TS)
    }
    const fileExists = host.fileExists.bind(host)
    host.fileExists = (name) => contents.has(name) || fileExists(name)
    const directoryExists = host.directoryExists?.bind(host)
    host.directoryExists = (name) => name === '/virtual' || !!directoryExists?.(name)
    const readFile = host.readFile.bind(host)
    host.readFile = (name) => contents.get(name) ?? readFile(name)
    program = ts.createProgram([...contents.keys()], options, host)
    expect(ts.getPreEmitDiagnostics(program)).toEqual([])

    const jsName = '/virtual/unchecked-cycle.js'
    const jsText = `function expose(){const local={nested:local};
      if(pick)return local;return local}external(expose);
      function named(){return 1}
      function exposeFunction(){return named}external(exposeFunction);
      const callback=callback;callback;
      with(scope){function forward(value){return value}forward(item)}`
    const jsOptions: ts.CompilerOptions = {
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
    }
    const jsHost = ts.createCompilerHost(jsOptions, true)
    const readJsSource = jsHost.getSourceFile.bind(jsHost)
    jsHost.getSourceFile = (name, languageVersion, onError, createNew) =>
      name === jsName
        ? ts.createSourceFile(name, jsText, languageVersion, true, ts.ScriptKind.JS)
        : readJsSource(name, languageVersion, onError, createNew)
    const jsFileExists = jsHost.fileExists.bind(jsHost)
    jsHost.fileExists = (name) => name === jsName || jsFileExists(name)
    const readJsFile = jsHost.readFile.bind(jsHost)
    jsHost.readFile = (name) => (name === jsName ? jsText : readJsFile(name))
    uncheckedProgram = ts.createProgram([jsName], jsOptions, jsHost)
    const source = uncheckedProgram.getSourceFile(jsName)
    if (!source) throw new Error('Missing unchecked JavaScript source')
    uncheckedSource = source
    expect(ts.getPreEmitDiagnostics(uncheckedProgram)).toEqual([])
  })

  it('rejects an exported options object when the proof has no consumer source list', () => {
    const checker = program.getTypeChecker()
    const declaration = source('exported.ts').statements.find(ts.isVariableStatement)
      ?.declarationList.declarations[0]
    if (!declaration || !ts.isIdentifier(declaration.name))
      throw new Error('Missing exported options declaration')
    const symbol = checker.getSymbolAtLocation(declaration.name)
    if (!symbol) throw new Error('Missing exported options symbol')
    expect(createContextValueStability(checker)(symbol)).toBe(false)
  })

  it('visits a cyclic import and reexport consumer graph once per source', () => {
    const checker = program.getTypeChecker()
    const first = source('cycle-a.ts')
    const second = source('cycle-b.ts')
    const consumers = createContextConsumerSources(checker, [first, second])
    expect(consumers(first)).toEqual([first, second])
    expect(consumers(second)).toEqual([second, first])
  })

  it('keeps shorthand, object rest, array rest, holes, and defaults as write targets', () => {
    const rows = assignments('targets.ts')
    expect(rows).toHaveLength(3)
    expect(contextWriteTargets(rows[0]!.left).map((node) => node.getText())).toEqual(['shorthand'])
    expect(contextWriteTargets(rows[1]!.left).map((node) => node.getText())).toEqual([
      'field.value',
      'rest',
    ])
    expect(contextWriteTargets(rows[2]!.left).map((node) => node.getText())).toEqual([
      'first',
      'tail',
    ])
  })

  it('fails a receiver proof when the actual options binding was overwritten', () => {
    const checker = program.getTypeChecker()
    const declaration = source('unstable.ts').statements.find(ts.isVariableStatement)
      ?.declarationList.declarations[0]
    if (!declaration || !ts.isIdentifier(declaration.name))
      throw new Error('Missing unstable options declaration')
    const symbol = checker.getSymbolAtLocation(declaration.name)
    if (!symbol) throw new Error('Missing unstable options symbol')
    const stability = createContextValueStability(checker, program.getSourceFiles())
    const resolver = createHttpContextValueResolver(checker, program.getSourceFiles())
    const guard = createContextReceiverGuard(checker, resolver.resolve)
    expect(stability.receivers(symbol, new Map(), guard.safe)).toBe(false)
  })

  it('rejects a bare function call as a receiver proof', () => {
    const checker = program.getTypeChecker()
    const call = source('direct-call.ts')
      .statements.filter(ts.isExpressionStatement)
      .map((statement) => statement.expression)
      .find(ts.isCallExpression)
    if (!call) throw new Error('Missing direct call')
    const resolver = createHttpContextValueResolver(checker, program.getSourceFiles())
    expect(createContextReceiverGuard(checker, resolver.resolve).safe(call, new Map())).toBe(false)
  })

  it('rejects a named callback that mutates its receiver while consuming the route context', () => {
    const checker = program.getTypeChecker()
    let call: ts.CallExpression | undefined
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'assertAccess'
      )
        call = node
      ts.forEachChild(node, visit)
    }
    visit(source('method-this.ts'))
    const argument = call?.arguments[0]
    if (!call || !argument || !ts.isIdentifier(argument)) throw new Error('Missing context call')
    const context = checker.getSymbolAtLocation(argument)
    if (!context) throw new Error('Missing context symbol')
    expect(opaqueHttpContextArgument(call, checker, context)).toBe(true)
  })

  it('rejects an inline object method that mutates this while consuming the route context', () => {
    const checker = program.getTypeChecker()
    let call: ts.CallExpression | undefined
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'inspect'
      )
        call = node
      ts.forEachChild(node, visit)
    }
    visit(source('inline-method-this.ts'))
    const argument = call?.arguments[0]
    if (!call || !argument || !ts.isIdentifier(argument))
      throw new Error('Missing inline context call')
    const context = checker.getSymbolAtLocation(argument)
    if (!context) throw new Error('Missing inline context symbol')
    expect(opaqueHttpContextArgument(call, checker, context)).toBe(true)
  })

  it('tracks a parameter returned twice by one real function only once', () => {
    const checker = program.getTypeChecker()
    const fn = source('repeat-return.ts').statements.find(ts.isFunctionDeclaration)
    const name = fn?.parameters[0]?.name
    if (!fn || !name || !ts.isIdentifier(name)) throw new Error('Missing repeated-return parameter')
    const parameter = checker.getSymbolAtLocation(name)
    if (!parameter) throw new Error('Missing repeated-return symbol')
    const wrappers = createLiteralWrapperIndex(checker, createContextValueRoots(checker))
    wrappers.record(fn)
    expect(wrappers.returnedParameters.has(parameter)).toBe(true)
    expect(wrappers.returnedParameters.size).toBe(1)
  })

  it('rejects an unchecked self alias while indexing a repeated recursive local return', () => {
    const checker = uncheckedProgram.getTypeChecker()
    const last = uncheckedSource.statements.findLast(ts.isExpressionStatement)
    if (!last) throw new Error('Missing unchecked self alias')
    expect(
      createHttpContextValueResolver(checker).resolve(last.expression, new Map()),
    ).toBeUndefined()
    const expose = uncheckedSource.statements.find(ts.isFunctionDeclaration)
    if (!expose?.name) throw new Error('Missing unchecked recursive function')
    const symbol = checker.getSymbolAtLocation(expose.name)
    if (!symbol) throw new Error('Missing unchecked recursive symbol')
    expect(createContextValueStability(checker)(symbol)).toBe(false)
    const returnedFunction = uncheckedSource.statements
      .filter(ts.isFunctionDeclaration)
      .find((node) => node.name?.text === 'exposeFunction')
    if (!returnedFunction?.name) throw new Error('Missing returned function')
    const returnedSymbol = checker.getSymbolAtLocation(returnedFunction.name)
    if (!returnedSymbol) throw new Error('Missing returned function symbol')
    expect(createContextValueStability(checker)(returnedSymbol)).toBe(true)
  })

  it('rejects a callback after spread forwarding its containing options', () => {
    const checker = program.getTypeChecker()
    const declaration = source('spread-forward.ts')
      .statements.filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find((item) => ts.isIdentifier(item.name) && item.name.text === 'result')
    if (!declaration?.initializer) throw new Error('Missing forwarded result')
    expect(
      createHttpContextValueResolver(checker, program.getSourceFiles()).resolve(
        declaration.initializer,
        new Map(),
      ),
    ).toBeUndefined()
  })

  it('resolves string-key namespace exports and selected imported aliases to their source object', () => {
    const checker = program.getTypeChecker()
    const declarations = source('alias-roots.ts')
      .statements.filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
    const moduleAccess = declarations[0]?.initializer
    const selectedAccess = declarations[1]?.name
    const exported = source('exported.ts').statements.find(ts.isVariableStatement)?.declarationList
      .declarations[0]?.name
    if (!moduleAccess || !selectedAccess || !ts.isIdentifier(selectedAccess) || !exported)
      throw new Error('Missing imported alias fixture')
    const symbol = checker.getSymbolAtLocation(exported)
    if (!symbol) throw new Error('Missing exported options symbol')
    const roots = createContextValueRoots(checker)
    expect(roots.root(moduleAccess)).toBe(symbol)
    expect(roots.root(selectedAccess)).toBe(symbol)
  })

  it('treats an aliased export and foreign destructured or class captures conservatively', () => {
    const checker = program.getTypeChecker()
    const alias = source('export-alias.ts').statements.find(ts.isVariableStatement)?.declarationList
      .declarations[0]?.name
    const expose = source('destructured-capture.ts').statements.find(ts.isFunctionDeclaration)?.name
    const classExpose = source('class-capture.ts').statements.find(ts.isFunctionDeclaration)?.name
    if (!alias || !expose || !classExpose) throw new Error('Missing alias or capture fixture')
    const aliasSymbol = checker.getSymbolAtLocation(alias)
    const exposeSymbol = checker.getSymbolAtLocation(expose)
    const classExposeSymbol = checker.getSymbolAtLocation(classExpose)
    if (!aliasSymbol || !exposeSymbol || !classExposeSymbol)
      throw new Error('Missing alias or capture symbol')
    const stability = createContextValueStability(checker)
    expect(stability(aliasSymbol)).toBe(false)
    expect(stability(exposeSymbol)).toBe(false)
    expect(stability(classExposeSymbol)).toBe(false)
  })

  it('ignores accessor and method members when identifying destructuring write targets', () => {
    const declaration = source('non-writable-members.ts').statements.find(ts.isVariableStatement)
      ?.declarationList.declarations[0]
    if (!declaration?.initializer) throw new Error('Missing object fixture')
    expect(contextWriteTargets(declaration.initializer)).toEqual([])
  })

  it('does not forward a callback through a function declared in an unchecked with scope', () => {
    let forwarded: ts.CallExpression | undefined
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText() === 'forward') forwarded = node
      ts.forEachChild(node, visit)
    }
    visit(uncheckedSource)
    if (!forwarded) throw new Error('Missing unchecked forwarding call')
    expect(contextForwardedTarget(uncheckedProgram.getTypeChecker(), forwarded, 0)).toBeUndefined()
  })
})
