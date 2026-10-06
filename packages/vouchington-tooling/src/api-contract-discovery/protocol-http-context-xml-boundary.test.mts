import { beforeAll, expect, it } from 'vitest'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import ts from '../contract-schema/typescript-api.mts'
import { mutatesHttpResponseMethod } from './protocol-http-method-mutations.mts'
const sources = {
  selected: `declare const app:any;app.route('/xml').get((ctx:any)=>ctx.response.xml('<value/>'))`,
  unrelated: `declare const app:any;declare const other:any;app.route('/xml').get((ctx:any)=>{other.response.xml('<value/>');ctx.json({safe:true})})`,
  overridden: `declare const app:any;app.route('/xml').get((ctx:any)=>{ctx.response.xml=()=>ctx.response.buffer('raw');ctx.response.xml('<value/>');ctx.json({safe:true})})`,
  opaque: `declare const app:any;app.route('/xml').get((ctx:any)=>{ctx.response.custom('<value/>');ctx.json({safe:true})})`,
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
it('retains the modeled selected XML dispatch', () => {
  const rows = discoverApiResponseContracts(matrix.program, [matrix.sourceFile('selected')])
  expect(rows['GET:/xml']?.mediaType).toBe('application/xml')
})
it('keeps unrelated XML calls independent', () => {
  const rows = discoverApiResponseContracts(matrix.program, [matrix.sourceFile('unrelated')])
  expect(rows['GET:/xml']?.unavailableReason).toBeUndefined()
  expect(rows['GET:/xml']?.mediaType).toBe('application/json')
})
it.each(['overridden', 'opaque'] as const)(
  'rejects altered or opaque selected dispatch %s',
  (name) => {
    const rows = discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile(name)],
      undefined,
      { onRouteError: () => {} },
    )
    if (name === 'overridden') {
      expect(rows).toEqual({})
      const file = matrix.sourceFile(name)
      let assignment: ts.BinaryExpression | undefined
      let context: ts.Symbol | undefined
      const visit = (node: ts.Node): void => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken)
          assignment = node
        if (ts.isParameter(node) && ts.isIdentifier(node.name))
          context = matrix.program.getTypeChecker().getSymbolAtLocation(node.name)
        ts.forEachChild(node, visit)
      }
      visit(file)
      expect(
        mutatesHttpResponseMethod(assignment!, context!, matrix.program.getTypeChecker()),
      ).toBe(true)
    } else expect(rows['GET:/xml']?.unavailableReason).toBeDefined()
  },
)
