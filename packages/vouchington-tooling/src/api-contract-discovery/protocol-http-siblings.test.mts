import { beforeAll, describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../openapi-document/index.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  type Http<T>=Response & {readonly apiHttpResponseVariants?:T}
  declare function apiOpenApiHttpResponse<K extends string,T>(key:K,response:Http<T>):Http<T>
  declare const json:Http<{status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}>;
  declare const empty:Http<{status:202;bodyKind:'none'}>;
  declare const unknownPayload:Http<{status:201;bodyKind:'content';mediaType:'application/json';body:unknown}>;
  declare const unknownBody:unknown;`
const first = `const first=apiOpenApiHttpResponse('POST:/rpc',json);
  ctx.setStatus(first.status);ctx.pipeline(first.body)`
const second = `const second=apiOpenApiHttpResponse('POST:/rpc#empty',empty);
  ctx.setStatus(second.status);if(!second.body)ctx.response.empty()`
const route = (left: string, right: string) => `${preamble}
  app.route('/rpc').post((ctx:any)=>{if(ctx.query.first){${left}}else{${right}}})`
const sources = {
  branches: route(first, second),
  sequential: `${preamble}app.route('/rpc').post((ctx:any)=>{
    ${first.replace('ctx.pipeline(first.body)', 'if(ctx.query.first){ctx.pipeline(first.body);return}')};${second}})`,
  interleaved: `${preamble}app.route('/rpc').post((ctx:any)=>{
    ${first.replace('ctx.pipeline(first.body)', '')};${second};ctx.pipeline(first.body)})`,
  'conditional-overwrite': `${preamble}app.route('/rpc').post((ctx:any)=>{
    ${first.replace('ctx.pipeline(first.body)', '')};if(ctx.query.empty){${second}};ctx.pipeline(first.body)})`,
  'per-branch-body-union': route(first, second)
    .replace(
      "declare const json:Http<{status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}>",
      "declare const json:Http<{status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}|{status:202;bodyKind:'none'}>",
    )
    .replace(
      'ctx.pipeline(first.body)',
      'if(!first.body)ctx.response.empty();else ctx.pipeline(first.body)',
    ),
  'missing-sibling-status': route(first, second.replace('ctx.setStatus(second.status);', '')),
  'missing-sibling-body': route(first, second.replace('if(!second.body)ctx.response.empty()', '')),
  'raw-sibling-body': route(first, `${second};ctx.json(unknownBody)`),
  'wrong-sibling-kind': route(first, `${second};ctx.pipeline(second.body)`),
  'unselected-unknown-payload': route(
    first,
    `const second=apiOpenApiHttpResponse('POST:/rpc#unknown',unknownPayload);
    ctx.setStatus(second.status);ctx.pipeline(second.body)`,
  ),
  'unselected-invalid-kind': route(first, second).replace("bodyKind:'none'", "bodyKind:'invalid'"),
  'unrelated-route': `${route(first, second)}
    app.route('/other').post((ctx:any)=>{const unselected=apiOpenApiHttpResponse('POST:/other',unknownPayload);
    ctx.setStatus(unselected.status);ctx.pipeline(unselected.body)})`,
} as const
let matrix: VirtualProgramMatrix<keyof typeof sources>
function discover(name: keyof typeof sources, keys?: readonly string[], lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    keys && new Set(keys),
    lenient ? { onRouteError: () => {} } : undefined,
  )
}

describe('coordinated opaque HTTP sibling proof', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(['branches', 'sequential'] as const)('documents independently proven %s', (name) => {
    const contracts = discover(name)
    expect(Object.keys(contracts)).toEqual(['POST:/rpc', 'POST:/rpc#empty'])
    expect(Object.values(contracts).map((row) => row.statusCodes)).toEqual([[200], [202]])
    expect(
      buildOpenApiDocument({ title: 'HTTP siblings', responseContracts: contracts })[
        'x-unavailable-routes'
      ],
    ).toEqual([])
  })
  it.each(['POST:/rpc', 'POST:/rpc#empty'])('preserves exact requested row %s', (key) => {
    const contracts = discover('branches', [key])
    expect(Object.keys(contracts)).toEqual([key])
    expect(contracts[key]!.unavailableReason).toBeUndefined()
  })
  it('keeps full per-response body-kind union proof', () => {
    const contracts = discover('per-branch-body-union')
    expect(Object.values(contracts).map((row) => row.bodyKind)).toEqual(['content', 'none', 'none'])
    expect(Object.values(contracts).every((row) => !row.unavailableReason)).toBe(true)
  })
  it.each([
    'interleaved',
    'conditional-overwrite',
    'missing-sibling-status',
    'missing-sibling-body',
    'raw-sibling-body',
    'wrong-sibling-kind',
  ] as const)('invalidates all selected rows for an unproven sibling %s', (name) => {
    expect(() => discover(name)).toThrow()
    const contracts = discover(name, undefined, true)
    expect(contracts['POST:/rpc']!.unavailableReason).toBeTruthy()
    expect(contracts['POST:/rpc#empty']!.unavailableReason).toBeTruthy()
    expect(
      buildOpenApiDocument({ title: 'Unproven sibling', responseContracts: contracts })[
        'x-unavailable-routes'
      ],
    ).toEqual(['POST:/rpc'])
    expect(() => discover(name, ['POST:/rpc'])).toThrow()
    expect(Object.keys(discover(name, ['POST:/rpc'], true))).toEqual(['POST:/rpc'])
  })
  it('does not extract an unselected sibling payload schema', () => {
    const contracts = discover('unselected-unknown-payload', ['POST:/rpc'])
    expect(Object.keys(contracts)).toEqual(['POST:/rpc'])
    expect(contracts['POST:/rpc']!.unavailableReason).toBeUndefined()
    expect(() => discover('unselected-unknown-payload')).toThrow()
  })
  it('fails selected sibling proof without adding an invalid unselected row', () => {
    expect(() => discover('unselected-invalid-kind', ['POST:/rpc'])).toThrow()
    const contracts = discover('unselected-invalid-kind', ['POST:/rpc'], true)
    expect(Object.keys(contracts)).toEqual(['POST:/rpc'])
    expect(contracts['POST:/rpc']!.unavailableReason).toBeTruthy()
  })
  it('does not validate unrequested or zero-selected routes', () => {
    expect(Object.keys(discover('unrelated-route', ['POST:/rpc']))).toEqual(['POST:/rpc'])
    expect(discover('unrelated-route', ['POST:/absent'])).toEqual({})
    expect(discover('unrelated-route', [])).toEqual({})
    expect(discover('branches', ['POST:/rpc#absent'])).toEqual({})
  })
})
