import { expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'

function checkedProgram(
  files: Record<string, string>,
  expectedCodes: readonly number[] = [],
): ts.Program {
  const options: ts.CompilerOptions = {
    // The shadowed eval control is a non-strict script; module fixtures remain strict.
    alwaysStrict: false,
    ignoreDeprecations: '6.0',
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
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (expectedCodes.length)
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expectedCodes)
  else
    expect(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      ),
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
  declare function opaque(value:any):void;
  type Context={params:{id:string};assert(value:boolean):void;json(value:any):void;setStatus(status:number):void};
  type Options={assertAccess?:(ctx:Context)=>void};
  function factory(options:Options){return(ctx:Context)=>{
    if(options.assertAccess)options.assertAccess(ctx);ctx.setStatus(204)}}`

const route = (setup: string, selected = 'options') => `${preamble}
  ${setup}
  app.route('/vote').put((ctx:Context)=>{
    apiNoContent('PUT:/vote');factory(${selected})(ctx)});export {};`

const controls = {
  direct: "eval('ctx.json({bad:true})')",
  parenthesized: "(eval)('ctx.json({bad:true})')",
  dead: "if(false)eval('ctx.json({bad:true})');ctx.assert(true)",
  shadowed: "{const eval=(_code:string)=>{};eval('ctx.json({bad:true})')}",
  indirect: "(0,eval)('globalThis.answer=1')",
  member: "globalThis.eval('globalThis.answer=1')",
  alias: "const evaluate=eval;evaluate('globalThis.answer=1')",
  optional: "eval?.('globalThis.answer=1')",
  unrelated: "function unused(){eval('ctx.json({bad:true})')};ctx.assert(true)",
} as const
const fixture = (name: keyof typeof controls) => ({
  'route.ts': route(`const options={assertAccess:(ctx:Context)=>{${controls[name]}}};`).replace(
    name === 'shadowed' ? 'export {};' : '__no_replacement__',
    '',
  ),
})
it.each(['direct', 'parenthesized'] as const)(
  'rejects intrinsic direct eval in bound context %s',
  (name) => expectUnknown(fixture(name)),
)
it.each(['dead', 'shadowed', 'indirect', 'member', 'alias', 'optional', 'unrelated'] as const)(
  'retains nonlexical or unexecuted eval in %s',
  (name) => expectNoContent(fixture(name)),
)

it.each([
  ['{},context:ctx', true],
  ['ctx,context:{}', false],
] as const)('uses the last duplicate literal property in %s', (properties, escaped) => {
  const body = `const {context:saved}=
{context:${properties}};opaque(saved)`
  const setup = (value: string) => ({
    'route.ts': route(`const options={assertAccess:(ctx:Context)=>{${value}}};`),
  })
  // The exact reported duplicate-key trigger has TS1117; retain that fact explicitly.
  checkedProgram(setup(body), [1117])
  const suppressed = setup(
    body.replace(
      '\n{context:',
      '// @ts-expect-error TS1117: deliberately test JavaScript last-property semantics\n{context:',
    ),
  )
  if (escaped) expectUnknown(suppressed)
  else expectNoContent(suppressed)
})

it('rejects direct intrinsic eval in the registered context itself', () => {
  expectUnknown({
    'route.ts': `${preamble}
    app.route('/vote').put((ctx:Context)=>{
      apiNoContent('PUT:/vote');eval('ctx.json({bad:true})');ctx.setStatus(204)
    });export {};`,
  })
})
