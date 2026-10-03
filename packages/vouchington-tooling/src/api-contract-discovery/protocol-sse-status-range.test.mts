import { beforeAll, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const route = (status: string) => `declare const app:any;
  declare const stream:{write(value:string):void};
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  app.route('/events').get((ctx:any)=>{ctx.setStatus(${status});
    stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))})`
const sources = {
  minimum: route('100'),
  maximum: route('599'),
  ordinary: route('200'),
  union: route('Math.random() ? 201 : 202'),
  low: route('99'),
  high: route('600'),
  fractional: route('200.5'),
  'invalid-union': route('Math.random() ? 99 : 200'),
  negative: route('-1'),
  nan: route('NaN'),
  infinity: route('Infinity'),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const discover = (name: keyof typeof sources, lenient = false) =>
  discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
it.each([
  ['minimum', [100]],
  ['maximum', [599]],
  ['ordinary', [200]],
  ['union', [201, 202]],
] as const)('keeps valid HTTP status codes in %s', (name, statuses) => {
  expect(Object.values(discover(name)).map(responseStatusCodesForContract)).toEqual([statuses])
})
it.each(['low', 'high', 'fractional', 'invalid-union'] as const)(
  'rejects an invalid concrete HTTP status in %s',
  (name) => {
    expect(() => discover(name)).toThrow('integer from 100 through 599')
    const contracts = discover(name, true)
    expect(Object.keys(contracts)).toEqual(['GET:/events'])
    expect(contracts['GET:/events']?.unavailableReason).toContain('integer from 100 through 599')
  },
)
it.each(['negative', 'nan', 'infinity'] as const)('fails closed for %s', (name) => {
  expect(() => discover(name)).toThrow()
  expect(discover(name, true)['GET:/events']?.unavailableReason).toBeTruthy()
})
