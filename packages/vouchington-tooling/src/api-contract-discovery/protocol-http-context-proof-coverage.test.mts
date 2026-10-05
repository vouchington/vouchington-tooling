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
} as const

type Case = keyof typeof sources
let matrix: VirtualProgramMatrix<Case>

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
})
