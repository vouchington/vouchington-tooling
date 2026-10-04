import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  declare const stream:{write(frame:string):void};
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  type Http<T>=Response&{readonly apiHttpResponseVariants?:T};
  declare function apiOpenApiHttpResponse<K extends string,T>(key:K,response:Http<T>):Http<T>;
  declare const opaque:Http<{status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}>;
  declare function nonterminal():void;`
const bodies = {
  sse: `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`,
  http: `const response=apiOpenApiHttpResponse('POST:/rpc',opaque);ctx.setStatus(response.status);ctx.pipeline(response.body)`,
} as const
const branches = {
  'true-return': 'if(true)return;',
  'true-wrapped-throw': 'if((true as const)){throw new Error()}',
  'false-else-return': 'if(false)nonterminal();else return;',
  'true-return-else-read': 'if(true)return;else nonterminal();',
  'exhaustive-return': 'if(ctx.query.stop)return;else throw new Error();',
  'false-return': 'if(false)return;',
  'true-nonterminal': 'if(true)nonterminal();',
  'false-else-nonterminal': 'if(false)return;else nonterminal();',
  'dynamic-return': 'if(ctx.query.stop)return;',
} as const
const sources = Object.fromEntries(
  Object.entries(branches).flatMap(([name, branch]) =>
    Object.entries(bodies).map(([protocol, body]) => [
      `${name}-${protocol}`,
      `${preamble}
    app.route('${protocol === 'sse' ? '/events' : '/rpc'}').${protocol === 'sse' ? 'get' : 'post'}((ctx:any)=>{${branch}${body}})`,
    ]),
  ),
)
let matrix: VirtualProgramMatrix<string>
function discover(name: string, lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
}
describe('literal terminal paths before protocol markers', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(
    [
      'true-return',
      'true-wrapped-throw',
      'false-else-return',
      'true-return-else-read',
      'exhaustive-return',
    ].flatMap((name) => ['sse', 'http'].map((protocol) => `${name}-${protocol}`)),
  )('rejects unreachable marker %s', (name) => {
    expect(() => discover(name)).toThrow()
    expect(Object.values(discover(name, true)).some((row) => row.unavailableReason)).toBe(true)
  })
  it.each(
    ['false-return', 'true-nonterminal', 'false-else-nonterminal', 'dynamic-return'].flatMap(
      (name) => ['sse', 'http'].map((protocol) => `${name}-${protocol}`),
    ),
  )('preserves potentially executable marker %s', (name) => {
    const contracts = Object.values(discover(name))
    expect(contracts).toHaveLength(1)
    expect(contracts[0]!.unavailableReason).toBeUndefined()
  })
})
