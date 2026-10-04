import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const stream:{write(value:string):void};
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));`
const route = (body: string) => `${preamble}app.route('/events').get((ctx:any)=>{${body}})`
const sources = {
  raw: route(`${frame}stream.write('raw')`),
  siblings: route(`${frame}${frame}stream.write('raw')`),
  'unbound-logger':
    route(frame) +
    `;declare const logger:{write(value:string):void};function log(){logger.write('log')}log()`,
  'different-route':
    route(frame) +
    `;declare const logger:{write(value:string):void};app.route('/logs').get((ctx:any)=>logger.write('log'))`,
  deferred: route(`${frame}function never(){stream.write('raw')}`),
  'dead-branch': route(`${frame}if(false)stream.write('raw')`),
  'after-return': route(`${frame}return;stream.write('raw')`),
  'called-local': route(`${frame}function emit(){stream.write('raw')}emit()`),
  'ignored-callback': route(
    `${frame}function ignore(callback:()=>void){}ignore(()=>stream.write('raw'))`,
  ),
  'consumed-callback': route(
    `${frame}function consume(callback:()=>void){callback()}consume(()=>stream.write('raw'))`,
  ),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
const discover = (name: keyof typeof sources, keys?: readonly string[], lenient = false) =>
  discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    keys && new Set(keys),
    lenient ? { onRouteError: () => {} } : undefined,
  )

describe('SSE raw-write execution and selected failures', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(['raw', 'siblings'] as const)('invalidates every selected emitted row in %s', (name) => {
    const keys = name === 'raw' ? ['GET:/events'] : ['GET:/events', 'GET:/events#protocol-2']
    expect(() => discover(name, keys)).toThrow('unmarked frame')
    const contracts = discover(name, keys, true)
    expect(Object.keys(contracts)).toEqual(keys)
    expect(Object.values(contracts).every((contract) => !!contract.unavailableReason)).toBe(true)
  })
  it('retains failure when only an exact suffix row is requested', () => {
    const key = 'GET:/events#protocol-2'
    const contracts = discover('siblings', [key], true)
    expect(Object.keys(contracts)).toEqual([key])
    expect(contracts[key]?.unavailableReason).toContain('unmarked frame')
  })
  it.each([
    'deferred',
    'dead-branch',
    'after-return',
    'ignored-callback',
    'unbound-logger',
    'different-route',
  ] as const)('preserves the framed route in %s', (name) => {
    const contracts = discover(name)
    expect(Object.keys(contracts)).toEqual(['GET:/events'])
    expect(contracts['GET:/events']?.unavailableReason).toBeUndefined()
  })
  it.each(['called-local', 'consumed-callback'] as const)(
    'rejects executable raw bytes in %s',
    (name) => {
      expect(() => discover(name)).toThrow('unmarked frame')
      const contracts = discover(name, ['GET:/events'], true)
      expect(contracts['GET:/events']?.unavailableReason).toContain('unmarked frame')
    },
  )
})
