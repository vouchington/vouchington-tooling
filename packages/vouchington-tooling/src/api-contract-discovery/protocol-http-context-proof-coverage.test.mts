import { beforeAll, describe, expect, it } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createContextValueRoots } from './protocol-http-context-value-roots.mts'
import { createContextValueStability } from './protocol-http-context-value-stability.mts'
import { createHttpContextValueResolver } from './protocol-http-context-values.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const sources = {
  'selected-property': `const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};const bag={chosen:options};const alias=bag.chosen;
    const result=alias.callback;`,
  'selected-destructure': `const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};const bag={chosen:options};const {chosen:alias}=bag;
    const result=alias.callback;`,
  'selected-nested': `const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};const bag={chosen:{nested:options}};
    const alias=bag.chosen.nested;const result=alias.callback;`,
  'selected-fallback': `const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};const bag={...{chosen:options}};
    const alias=bag.chosen;const result=alias.callback;`,
  'literal-key': `const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};const bag={'chosen':options};
    const {'chosen':alias}=bag;const result=alias.callback;`,
  'binding-shorthand': `const fn=(ctx:any)=>ctx.assert(true);
    const options={callback:fn};const {callback}=options;const result=callback;`,
  'read-alias': `const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};const bag={chosen:options};
    const alias=bag.chosen;const result=alias.callback;`,
  'written-alias': `const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};const bag={chosen:options};
    const alias=bag.chosen;alias.callback=()=>{};const result=options.callback;`,
  'escaped-alias': `declare function opaque(value:unknown):void;
    const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};const bag={chosen:options};
    opaque(bag);const result=options.callback;`,
  'absent-property': `const callback=(ctx:any)=>ctx.assert(true);
    const options:{other:typeof callback;callback?:typeof callback}={other:callback};
    const result=options.callback;`,
  'proto-property': `const callback=(ctx:any)=>ctx.assert(true);
    const options={__proto__:null,other:callback} as {callback?:typeof callback};
    const result=options.callback;`,
  'spread-override': `const callback=(ctx:any)=>ctx.assert(true);
    const original:{callback?:typeof callback}={callback};
    const options={callback:null,...original};
    const result=options.callback;`,
  'spread-fallback': `const callback=(ctx:any)=>ctx.assert(true);
    const other={different:callback};const options={callback,...other};
    const result=options.callback;`,
  'unary-write': `const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};(options as any).callback++;
    const result=options.callback;`,
  'sparse-spread-array': `const callback=(ctx:any)=>ctx.assert(true);
    const options={callback};const bag=[,...[options]];
    const result=options.callback;`,
  'optional-null-owner': `declare const choose:boolean;
    const callback=(ctx:any)=>ctx.assert(true);
    const options=choose?null:{callback};const result=options?.callback;`,
} as const

type Case = keyof typeof sources
let matrix: VirtualProgramMatrix<Case>

function uncheckedProgram() {
  const fileName = '/virtual/unchecked-context.js'
  const contents = `const callback=ctx=>ctx.assert(true);
    const options={callback};
    const {item:fromUnknown}=externalBag;
    const [fromArray]=externalArray;
    function inspect({item:fromParameter}){return fromParameter.callback}
    const bag={missingShorthand};
    const alias=bag.missingShorthand;
    missingGlobal;fromUnknown;fromArray;bag.missingShorthand;alias;`
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
  }
  const host = ts.createCompilerHost(options, true)
  const readSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, createNew) =>
    name === fileName
      ? ts.createSourceFile(name, contents, languageVersion, true, ts.ScriptKind.JS)
      : readSourceFile(name, languageVersion, onError, createNew)
  host.fileExists = (
    (exists) => (name: string) =>
      name === fileName || exists(name)
  )(host.fileExists.bind(host))
  host.readFile = (
    (read) => (name: string) =>
      name === fileName ? contents : read(name)
  )(host.readFile.bind(host))
  const program = ts.createProgram([fileName], options, host)
  const source = program.getSourceFile(fileName)
  if (!source) throw new Error('Compiler did not load unchecked JavaScript source')
  return { program, source }
}

function initializer(name: Case): ts.Expression {
  const declaration = matrix
    .sourceFile(name)
    .statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((item) => ts.isIdentifier(item.name) && item.name.text === 'result')
  if (!declaration?.initializer) throw new Error(`Missing result in ${name}`)
  return declaration.initializer
}

function symbol(name: Case, variable: string): ts.Symbol {
  const declaration = matrix
    .sourceFile(name)
    .statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((item) => ts.isIdentifier(item.name) && item.name.text === variable)
  if (!declaration || !ts.isIdentifier(declaration.name))
    throw new Error(`Missing ${variable} in ${name}`)
  const found = matrix.program.getTypeChecker().getSymbolAtLocation(declaration.name)
  if (!found) throw new Error(`Missing symbol for ${variable} in ${name}`)
  return found
}

describe('HTTP context proof follows real TypeScript bindings and object values', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })

  it.each([
    ['selected-property', 'options'],
    ['selected-destructure', 'options'],
    ['selected-nested', 'bag'],
    ['selected-fallback', 'bag'],
    ['literal-key', 'options'],
    ['binding-shorthand', 'fn'],
  ] as const)('finds the mutable origin of %s', (name, origin) => {
    const checker = matrix.program.getTypeChecker()
    const roots = createContextValueRoots(checker)
    expect(roots.root(initializer(name))).toBe(symbol(name, origin))
  })

  it('accepts a stable callback through an object alias', () => {
    const checker = matrix.program.getTypeChecker()
    expect(createContextValueStability(checker)(symbol('read-alias', 'options'))).toBe(true)
    const values = createHttpContextValueResolver(checker).resolve(
      initializer('read-alias'),
      new Map(),
    )
    expect(values?.map((value) => value?.node.kind)).toEqual([ts.SyntaxKind.ArrowFunction])
  })

  it.each(['written-alias', 'escaped-alias'] as const)(
    'rejects a callback after %s changes its containing object',
    (name) => {
      const checker = matrix.program.getTypeChecker()
      expect(createContextValueStability(checker)(symbol(name, 'options'))).toBe(false)
      expect(
        createHttpContextValueResolver(checker).resolve(initializer(name), new Map()),
      ).toBeUndefined()
    },
  )

  it('distinguishes a missing property from an object with an unsafe prototype', () => {
    const checker = matrix.program.getTypeChecker()
    const resolver = createHttpContextValueResolver(checker)
    expect(resolver.resolve(initializer('absent-property'), new Map())).toEqual([null])
    expect(resolver.resolve(initializer('proto-property'), new Map())).toBeUndefined()
  })

  it.each(['spread-override', 'spread-fallback'] as const)(
    'retains a concrete callback after %s',
    (name) => {
      const checker = matrix.program.getTypeChecker()
      const values = createHttpContextValueResolver(checker).resolve(initializer(name), new Map())
      expect(values?.map((value) => value?.node.kind)).toEqual([ts.SyntaxKind.ArrowFunction])
    },
  )

  it('rejects a callback mutated by a unary write', () => {
    const checker = matrix.program.getTypeChecker()
    expect(createContextValueStability(checker)(symbol('unary-write', 'options'))).toBe(false)
    expect(
      createHttpContextValueResolver(checker).resolve(initializer('unary-write'), new Map()),
    ).toBeUndefined()
  })

  it('retains a callback inside a sparse array with a spread element', () => {
    const checker = matrix.program.getTypeChecker()
    const values = createHttpContextValueResolver(checker).resolve(
      initializer('sparse-spread-array'),
      new Map(),
    )
    expect(values?.map((value) => value?.node.kind)).toEqual([ts.SyntaxKind.ArrowFunction])
  })

  it('preserves absence and a concrete callback through optional property access', () => {
    const checker = matrix.program.getTypeChecker()
    const values = createHttpContextValueResolver(checker).resolve(
      initializer('optional-null-owner'),
      new Map(),
    )
    expect(values?.map((value) => value?.node.kind ?? null)).toEqual([
      null,
      ts.SyntaxKind.ArrowFunction,
    ])
  })
})

describe('HTTP context proof treats unresolved unchecked JavaScript as unknown', () => {
  let program: ts.Program
  let source: ts.SourceFile
  let expressions: ts.Expression[]

  beforeAll(() => {
    ;({ program, source } = uncheckedProgram())
    expect([
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ]).toEqual([])
    expressions = source.statements
      .filter(ts.isExpressionStatement)
      .map((statement) => statement.expression)
  })

  it('does not resolve an undeclared global as a callback', () => {
    const checker = program.getTypeChecker()
    expect(createContextValueRoots(checker).root(expressions[0]!)).toBeUndefined()
    expect(
      createHttpContextValueResolver(checker).resolve(expressions[0]!, new Map()),
    ).toBeUndefined()
  })

  it('does not infer an object destructure from an unresolved owner', () => {
    const checker = program.getTypeChecker()
    expect(createContextValueRoots(checker).root(expressions[1]!)).toBeUndefined()
    expect(
      createHttpContextValueResolver(checker).resolve(expressions[1]!, new Map()),
    ).toBeUndefined()
  })

  it('keeps array and parameter destructures rooted in their own bindings', () => {
    const checker = program.getTypeChecker()
    const roots = createContextValueRoots(checker)
    const arrayRoot = roots.root(expressions[2]!)
    expect(arrayRoot?.name).toBe('fromArray')
    const functionNode = source.statements.find(ts.isFunctionDeclaration)
    if (!functionNode || !ts.isObjectBindingPattern(functionNode.parameters[0]!.name))
      throw new Error('Missing destructured function parameter')
    const parameterName = functionNode.parameters[0]!.name.elements[0]!.name
    if (!ts.isIdentifier(parameterName)) throw new Error('Missing parameter binding')
    expect(roots.root(parameterName)?.name).toBe('fromParameter')
  })

  it('does not invent a callback for an unresolved shorthand property', () => {
    const checker = program.getTypeChecker()
    const roots = createContextValueRoots(checker)
    expect(roots.root(expressions[3]!)?.name).toBe('bag')
    expect(roots.root(expressions[4]!)?.name).toBe('bag')
    expect(
      createHttpContextValueResolver(checker).resolve(expressions[3]!, new Map()),
    ).toBeUndefined()
  })
})
