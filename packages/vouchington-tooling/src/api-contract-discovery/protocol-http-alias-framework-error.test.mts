import { beforeAll, describe, expect, it } from 'vitest'
import { buildOpenApiDocument, type OpenApiResponse } from '../openapi-document/index.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  type Http<T>=Response & {readonly apiHttpResponseVariants?:T}
  declare function apiOpenApiHttpResponse<K extends string,T>(key:K,response:Http<T>):Http<T>
  declare const opaque:Http<{status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}>;
  declare const unknownBody:unknown;
  declare const other:any;`
const body = `const response=apiOpenApiHttpResponse('POST:/rpc',opaque);
  ctx.setStatus(response.status);ctx.pipeline(response.body);`
const route = (extra: string) => `${preamble}app.route('/rpc').post((ctx:any)=>{${body}${extra}})`
const empty = (status: number) => `${preamble}
  declare const empty:Http<{status:${status};bodyKind:'none'}>;
  app.route('/rpc').post((ctx:any)=>{const response=apiOpenApiHttpResponse('POST:/rpc',empty);
    ctx.setStatus(response.status);if(!response.body)ctx.response.empty()})`
const sources = {
  'assigned-context': route('let sender:any;sender=ctx;sender.json(unknownBody)'),
  'assigned-response': route('let sender:any;sender=ctx.response;sender.buffer(unknownBody)'),
  'assigned-const-alias': route(
    'const context=ctx;let sender:any;sender=context;sender.json(unknownBody)',
  ),
  'called-nested-assignment': route(
    'let sender:any;function assign(){sender=ctx};assign();sender.json(unknownBody)',
  ),
  'dead-assignment': route('let sender:any;if(false){sender=ctx}'),
  'uncalled-assignment': route('let sender:any;function assign(){sender=ctx}'),
  'unrelated-assignment': route('let sender:any;sender=other;sender.json(unknownBody)'),
  'parameter-value-assignment': route('let value:any;value=ctx.params.id'),
  'query-value-assignment': route('let value:any;value=ctx.query'),
  'shadowed-context': route('function assign(ctx:any){let sender:any;sender=ctx};assign(other)'),
  'const-context-alias': route('const context=ctx;context.setStatus(response.status)'),
  'empty-400': empty(400),
  'empty-202': empty(202),
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
function discover(name: keyof typeof sources, lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
}

describe('HTTP assignment aliases and bodyless framework errors', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each([
    'assigned-context',
    'assigned-response',
    'assigned-const-alias',
    'called-nested-assignment',
  ] as const)('rejects unanalyzed assigned response alias %s', (name) => {
    expect(() => discover(name)).toThrow(/unsupported mutable alias/)
    expect(Object.values(discover(name, true)).some((row) => row.unavailableReason)).toBe(true)
  })
  it.each([
    'dead-assignment',
    'uncalled-assignment',
    'unrelated-assignment',
    'parameter-value-assignment',
    'query-value-assignment',
    'shadowed-context',
    'const-context-alias',
  ] as const)('preserves unrelated or nonexecuted assignment %s', (name) => {
    expect(Object.values(discover(name)).every((row) => !row.unavailableReason)).toBe(true)
  })
  it('retains framework JSON possibility for an explicitly bodyless 400', () => {
    const contracts = discover('empty-400')
    expect(contracts['POST:/rpc']!.includeDefaultError).toBe(true)
    const document = buildOpenApiDocument({ title: 'HTTP400', responseContracts: contracts })
    expect(document['x-unavailable-routes']).toEqual(['POST:/rpc'])
    expect(document.paths['/rpc']!.post!['x-schema-unavailable-reason']).toContain(
      'status 400 has both body and no-body variants',
    )
  })
  it('preserves a notification 202 without body or content type', () => {
    const contracts = discover('empty-202')
    expect(contracts['POST:/rpc']!.includeDefaultError).toBeUndefined()
    const document = buildOpenApiDocument({ title: 'HTTP202', responseContracts: contracts })
    expect(document['x-unavailable-routes']).toEqual([])
    expect(
      (document.paths['/rpc']!.post!.responses[202] as OpenApiResponse).content,
    ).toBeUndefined()
  })
})
