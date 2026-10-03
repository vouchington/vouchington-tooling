import { beforeAll, expect, it } from 'vitest'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { discoverApiRequestContracts } from './request-contract-registry.mts'
import { discoverApiQueryContracts } from './query-contract-registry.mts'
import { discoverApiHeaderContracts } from './header-contract-registry.mts'
const preamble = `declare const app:any;declare function apiResponse<K extends string,T>(key:K,body:T):T;declare function apiRequest<K extends string,T>(key:K,body:T):T;declare function apiQuery(key:string,...values:unknown[]):void;declare function apiHeaders(key:string,value:unknown):void;`
const markers = {
  response: "apiResponse('GET:/x',{ok:true})",
  request: "apiRequest('GET:/x',{ok:true})",
  query: "apiQuery('GET:/x',{queryContract:{term:{kind:'string' as const}}})",
  headers: "apiHeaders('GET:/x',{request:{'x-token':{type:'string'}}})",
}
const sources = Object.fromEntries(
  Object.entries(markers).flatMap(([name, marker]) => [
    [
      name + '-ignored',
      `${preamble}function factory(cb:()=>void){return(ctx:any)=>{}}app.route('/x').get(factory(()=>${marker}))`,
    ],
    [
      name + '-invoked',
      `${preamble}function factory(cb:()=>void){return(ctx:any)=>{cb()}}app.route('/x').get(factory(()=>${marker}))`,
    ],
    [name + '-unused', `${preamble}app.route('/x').get((ctx:any)=>{function unused(){${marker}}})`],
    [
      name + '-named-unused',
      `${preamble}function handler(ctx:any){function unused(){${marker}}}app.route('/x').get(handler)`,
    ],
    [
      name + '-global-unused',
      `${preamble}function helper(){${marker}}app.route('/x').get((ctx:any)=>{function unused(){helper()}})`,
    ],
    [
      name + '-global-called',
      `${preamble}function helper(){${marker}}app.route('/x').get((ctx:any)=>{helper()})`,
    ],
    [
      name + '-global-dead',
      `${preamble}function helper(){${marker}}app.route('/x').get((ctx:any)=>{if(false)helper()})`,
    ],
    [
      name + '-called',
      `${preamble}app.route('/x').get((ctx:any)=>{function called(){${marker}}called()})`,
    ],
  ]),
)
sources['chained-response'] =
  `${preamble}app.route('/x').get((ctx:any)=>{}).patch((ctx:any)=>{}).delete((ctx:any)=>apiResponse('DELETE:/x',{ok:true}))`
let matrix: VirtualProgramMatrix<string>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
const discover = {
  response: discoverApiResponseContracts,
  request: discoverApiRequestContracts,
  query: discoverApiQueryContracts,
  headers: discoverApiHeaderContracts,
}
it.each(Object.keys(discover) as (keyof typeof discover)[])(
  'proves %s callback execution before attributing a route',
  (name) => {
    const run = (suffix: string) =>
      discover[name](matrix.program, [matrix.sourceFile(name + suffix)], new Set(['GET:/x']))
    expect(() => run('-ignored')).toThrow('must be inside')
    expect(() => run('-unused')).toThrow('must be inside')
    expect(() => run('-named-unused')).toThrow('must be inside')
    expect(() => run('-global-unused')).toThrow('must be inside')
    expect(() => run('-global-dead')).toThrow('must be inside')
    expect(Object.keys(run('-global-called'))).toEqual(['GET:/x'])
    expect(Object.keys(run('-invoked'))).toEqual(['GET:/x'])
    expect(Object.keys(run('-called'))).toEqual(['GET:/x'])
  },
)

it('attributes a response to its actual method in a fluent registration chain', () => {
  const contracts = discoverApiResponseContracts(matrix.program, [
    matrix.sourceFile('chained-response'),
  ])
  expect(Object.keys(contracts)).toEqual(['DELETE:/x'])
  expect(contracts['DELETE:/x']?.method).toBe('DELETE')
})
