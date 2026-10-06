import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { opaqueHttpContextArgument } from './protocol-http-context-escapes.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function checkedProgram(files: Record<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
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

function contract(files: Record<string, string>) {
  const program = checkedProgram(files)
  const source = program.getSourceFile('/virtual/route.ts')
  if (!source) throw new Error('Missing route source')
  return discoverApiResponseContracts(program, [source], new Set(['PUT:/vote']))['PUT:/vote']
}

function expectUnknown(files: Record<string, string>): void {
  const row = contract(files)
  expect(row?.statusKnowledge).toBe('unknown')
  expect(row?.unavailableReason).toBeTruthy()
}

function expectNoContent(files: Record<string, string>): void {
  const row = contract(files)
  expect(row?.unavailableReason).toBeUndefined()
  expect(responseStatusCodesForContract(row!)).toEqual([204])
}

const preamble = `declare const app:any;
  declare function apiNoContent(key:string):void;
  type Context={assert(value:boolean):void;json(value:any):void;setStatus(status:number):void;
    response:{json(value:any):void}};
  function factory(options:{assertAccess:(ctx:Context)=>void}){return(ctx:Context)=>{
    options.assertAccess(ctx);ctx.setStatus(204)}}`

function fixture(body: string) {
  return {
    'route.ts': `${preamble}
    const options={assertAccess:(ctx:Context)=>{${body}}};
    app.route('/vote').put((ctx:Context)=>{
      apiNoContent('PUT:/vote');factory(options)(ctx)});export {};`,
  }
}

it.each(['ctx', 'ctx.response'])('rejects an opaque direct %s method receiver', (receiver) => {
  expectUnknown(fixture(`(${receiver} as typeof ${receiver}&{leak():void}).leak()`))
})

it.each(['ctx', 'ctx.response'])('keeps a read-only direct %s method reference', (receiver) => {
  expectNoContent(fixture(`void (${receiver} as typeof ${receiver}&{leak():void}).leak`))
})

it('keeps an independent opaque method receiver', () => {
  expectNoContent(fixture(`const other={} as {leak():void};other.leak()`))
})

it.each(['ctx', 'ctx.response'])('keeps a dead direct %s method invocation', (receiver) => {
  expectNoContent(fixture(`if(false)(${receiver} as typeof ${receiver}&{leak():void}).leak()`))
})

it('keeps a known concrete ignored method on a context-containing receiver', () => {
  expectNoContent(fixture(`const wrapper={ctx,ignore(){}};wrapper.ignore()`))
})

it.each(['ctx.ignore', 'ctx.response.ignore'])(
  'proves a concrete ignored direct %s method',
  (name) => {
    const program = checkedProgram({
      'route.ts': `const ctx={ignore(){},response:{ignore(){}}};
    ${name}();export {};`,
    })
    const source = program.getSourceFile('/virtual/route.ts')!
    let call: ts.CallExpression | undefined
    let context: ts.Symbol | undefined
    const checker = program.getTypeChecker()
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'ctx')
        context = checker.getSymbolAtLocation(node.name)
      if (ts.isCallExpression(node)) call = node
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(call).toBeDefined()
    expect(context).toBeDefined()
    expect(opaqueHttpContextArgument(call!, checker, context!)).toBe(false)
  },
)

it.each(['ctx', 'ctx.response'])('rejects a declared opaque direct %s method', (receiver) => {
  const files = fixture(`${receiver}.leak()`)
  files['route.ts'] = files['route.ts']
    .replace('assert(value:boolean)', 'leak():void;assert(value:boolean)')
    .replace('response:{json', 'response:{leak():void;json')
  expectUnknown(files)
})

it('keeps the canonical assertion operation on the selected context', () => {
  expectNoContent(fixture('ctx.assert(true)'))
})
