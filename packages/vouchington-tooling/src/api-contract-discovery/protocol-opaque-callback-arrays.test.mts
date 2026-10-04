import { beforeAll, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../openapi-document/index.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;declare const stream:{write(value:string):void};
  declare const other:typeof stream;declare const raw:unknown;
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  declare function apiResponse<T>(key:string,body:T):T;
  declare function opaque(value:unknown):void;
  function ignore(value:unknown){}`
const cases = {
  direct: `opaque([()=>EMIT])`,
  tuple: `opaque([()=>EMIT] as const)`,
  alias: `const callbacks=[()=>EMIT];opaque(callbacks)`,
  nested: `opaque({callbacks:[{emit:()=>EMIT}]})`,
  forwarded: `function forward(callbacks:unknown){opaque(callbacks)}forward([()=>EMIT])`,
  spread: `const callbacks=[()=>EMIT];opaque([...callbacks])`,
  dead: `if(false)opaque([()=>EMIT])`,
  ignored: `ignore([()=>EMIT])`,
  unused: `function unused(){opaque([()=>EMIT])}`,
  different: `opaque([()=>OTHER])`,
  empty: `opaque([])`,
} as const
const rejected = new Set(['direct', 'tuple', 'alias', 'nested', 'forwarded', 'spread'])
const sources = Object.fromEntries(
  Object.entries(cases).flatMap(([name, body]) => [
    [
      'sse-' + name,
      `${preamble}app.route('/events').get(()=>{
    stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}));
    ${body.replaceAll('EMIT', "stream.write('raw')").replaceAll('OTHER', "other.write('raw')")}})`,
    ],
    [
      'http-' + name,
      `${preamble}app.route('/rpc').post((ctx:any)=>{
    ctx.json(apiResponse('POST:/rpc',{ok:true}));
    ${body.replaceAll('EMIT', 'ctx.pipeline(raw)').replaceAll('OTHER', "other.write('raw')")}})`,
    ],
  ]),
)
let matrix: VirtualProgramMatrix<string>
beforeAll(() => {
  matrix = buildVirtualProgramMatrix(import.meta, sources)
})
function discover(name: string, lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
}
it.each(Object.keys(cases))('tracks opaque callback arrays in %s', (name) => {
  if (rejected.has(name)) {
    expect(() => discover('sse-' + name)).toThrow('unmarked frame')
    expect(discover('sse-' + name, true)['GET:/events']?.unavailableReason).toBeTruthy()
  } else expect(discover('sse-' + name)['GET:/events']?.unavailableReason).toBeUndefined()
  for (const lenient of [false, true]) {
    const doc = buildOpenApiDocument({
      title: 'Callback array',
      responseContracts: discover('http-' + name, lenient),
    })
    expect(doc['x-unavailable-routes']).toEqual(rejected.has(name) ? ['POST:/rpc'] : [])
  }
})
