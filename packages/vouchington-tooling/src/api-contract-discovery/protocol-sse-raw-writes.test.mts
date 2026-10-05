import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import ts from '../contract-schema/typescript-api.mts'
import { rejectRawSseWrites, type SseRouteWrites } from './protocol-sse-raw-writes.mts'
import { visit, type RouteBinding } from './response-contract-route-analysis.mts'
import { createSseWriteLookup } from './protocol-sse-write-helpers.mts'
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
  large: `function helper(){${Array.from({ length: 96 }, (_, index) => `noise(${index})`).join(';')}}
    ${route(`${frame}helper();stream.write('raw')`)};declare function noise(value:number):void`,
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
  it('skips source traversal when the discovery has no selected SSE routes', () => {
    const files = new Proxy([] as ts.SourceFile[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error('unexpected source traversal')
        return Reflect.get(target, property, receiver)
      },
    })

    expect(() =>
      rejectRawSseWrites(
        files,
        matrix.program.getTypeChecker(),
        new Map<ts.Symbol, RouteBinding>(),
        new Set<ts.CallExpression>(),
        new Map<string, SseRouteWrites>(),
        () => {},
      ),
    ).not.toThrow()
  })
  it('indexes executable callers with one resolved-signature lookup per call', () => {
    const calls: ts.CallExpression[] = []
    visit(matrix.sourceFile('large'), (node) => {
      if (ts.isCallExpression(node)) calls.push(node)
    })
    const checker = matrix.program.getTypeChecker()
    let signatureLookups = 0
    const observedChecker = new Proxy(checker, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (property === 'getResolvedSignature')
          return (...args: Parameters<typeof checker.getResolvedSignature>) => {
            signatureLookups += 1
            return checker.getResolvedSignature(...args)
          }
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as ts.TypeChecker
    const lookup = createSseWriteLookup(calls, observedChecker, new Map())
    const noiseCall = calls.find(
      (call) => ts.isIdentifier(call.expression) && call.expression.text === 'noise',
    )!

    expect(lookup.helperBindings(noiseCall)).toEqual([{ method: 'GET', routeTemplate: '/events' }])
    expect(signatureLookups).toBe(calls.length)
    lookup.helperBindings(noiseCall)
    expect(signatureLookups).toBe(calls.length)

    const nextDiscovery = createSseWriteLookup(calls, observedChecker, new Map())
    nextDiscovery.helperBindings(noiseCall)
    expect(signatureLookups).toBe(calls.length * 2)
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
  it('still rejects raw bytes on the selected SSE route in a large source', () => {
    expect(() => discover('large')).toThrow('unmarked frame')
  })
})
