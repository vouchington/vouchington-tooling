import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ts from '../contract-schema/typescript-api.mts'
import { createHttpContextValueResolver } from './protocol-http-context-values.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

let matrix: VirtualProgramMatrix<'repeated'>
describe('HTTP context proof retains its source mutation index', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, {
      repeated: `const foreign:any={};const options={assertAccess:(ctx:any)=>ctx.assert(true)};
        ${'foreign.value=1;'.repeat(40)}options.assertAccess;`,
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
  it('reuses stability facts while resolving the same callback repeatedly', () => {
    const source = matrix.sourceFile('repeated')
    const statement = source.statements.findLast(ts.isExpressionStatement)!
    const checker = matrix.program.getTypeChecker()
    const symbols = vi.spyOn(checker, 'getSymbolAtLocation')
    const resolver = createHttpContextValueResolver(checker)
    const first = resolver.resolve(statement.expression, new Map())
    expect(first?.[0]?.node.kind).toBe(ts.SyntaxKind.ArrowFunction)
    const before = symbols.mock.calls.length
    for (let index = 0; index < 20; index++)
      expect(resolver.resolve(statement.expression, new Map())?.[0]?.node).toBe(first?.[0]?.node)
    // Each read resolves the options identifier; its forty unrelated writes are indexed once.
    expect(symbols.mock.calls.length - before).toBe(20)
  })
})
