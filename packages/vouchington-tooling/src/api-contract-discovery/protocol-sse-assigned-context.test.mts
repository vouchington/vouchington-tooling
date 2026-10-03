import { beforeAll, expect, it } from 'vitest'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const stream:{write(frame:string):void};
  declare function apiSseFrame<K extends string,const T>(key:K,event:T):string;`
const route = (setup: string) => `${preamble}app.route('/events').get((ctx:any)=>{
  ${setup}stream.write(apiSseFrame('GET:/events',{event:'done',data:{ok:true}}))})`
const sources = {
  direct: route('let output:any;output=ctx;output.setStatus(201);'),
  alias: route('const context=ctx;let output:any;output=context;output.setStatus(201);'),
  called: route('let output:any;function assign(){output=ctx;output.setStatus(201)}assign();'),
  dead: route('let output:any;if(false){output=ctx;output.setStatus(201)}'),
  unused: route('let output:any;function assign(){output=ctx;output.setStatus(201)}'),
  unrelated: route('let output:any;output=ctx.query;'),
  shadowed: route('function assign(ctx:any){let output:any;output=ctx}assign({});'),
  constant: route('const output=ctx;output.setStatus(201);'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
it.each(['direct', 'alias', 'called'] as const)('rejects assigned SSE context %s', (name) => {
  const run = (lenient = false) =>
    discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile(name)],
      undefined,
      lenient ? { onRouteError: () => {} } : undefined,
    )
  expect(() => run()).toThrow('unsupported mutable or destructured alias')
  expect(Object.values(run(true)).every((row) => row.unavailableReason)).toBe(true)
})
it.each(['dead', 'unused', 'unrelated', 'shadowed'] as const)(
  'keeps unrelated or unexecuted alias %s',
  (name) => {
    const contracts = discoverApiResponseContracts(matrix.program, [matrix.sourceFile(name)])
    expect(contracts['GET:/events']?.unavailableReason).toBeUndefined()
    expect(responseStatusCodesForContract(contracts['GET:/events']!)).toEqual([200])
  },
)
it('retains a bound constant alias status', () => {
  const contracts = discoverApiResponseContracts(matrix.program, [matrix.sourceFile('constant')])
  expect(contracts['GET:/events']?.statusCodes).toEqual([201])
})
