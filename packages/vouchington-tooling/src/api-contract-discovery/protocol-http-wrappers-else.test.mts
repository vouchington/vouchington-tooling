import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  type Content={status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}};
  type Empty={status:202;bodyKind:'none'};
  type Http<T>=Response & {readonly apiHttpResponseVariants?:T};
  declare const original:Http<Content|Empty>;
  declare const unrelated:Response;
  declare const raw:unknown;
  declare function apiOpenApiHttpResponse<K extends string,T>(key:K,response:Http<T>):Http<T>;
  declare function apiResponse<K extends string,T>(key:K,body:T):T;`
const dispatch = `const response=apiOpenApiHttpResponse('POST:/rpc',original);
  ctx.setStatus(response.status);
  if(!response.body)ctx.response.empty();else ctx.pipeline(response.body);`
const route = (body: string) => `${preamble}
  app.route('/rpc').post((ctx:any)=>{${body}})`
const wrapper = (emission: string) =>
  route(`const wrapper={ctx};
  if(ctx.query.raw){${emission}}else{${dispatch}}`)
const implicit = (emission: string) =>
  route(`const wrapper={ctx};
  if(ctx.query.raw){${emission}}else{ctx.json(apiResponse('POST:/rpc',{ok:true}))}`)
const sources = {
  'else-direct': route(`const response=apiOpenApiHttpResponse('POST:/rpc',original);
    ctx.setStatus(response.status);if(response.body)ctx.pipeline(response.body);else ctx.response.empty()`),
  'else-wrapped': route(`const response=apiOpenApiHttpResponse('POST:/rpc',original);
    ctx.setStatus(response.status);if(((response.body)))ctx.pipeline(response.body);
    else {if(ctx.query.empty)ctx.response.empty();else ctx.response.empty()}`),
  'const-context-alias': route(`const alias=ctx;${dispatch.replaceAll('ctx.', 'alias.')}`),
  'dead-wrapper': route(`const wrapper={ctx};if(false)wrapper.ctx.pipeline(raw);${dispatch}`),
  'foreign-wrapper': route(`const wrapper={ctx:{pipeline(value:unknown){}}};
    wrapper.ctx.pipeline(raw);${dispatch}`),
  'wrapper-pipeline': wrapper('wrapper.ctx.pipeline(raw)'),
  'wrapper-buffer': wrapper('wrapper.ctx.response.buffer(raw)'),
  'wrapper-json': wrapper('wrapper.ctx.json(raw)'),
  'wrapper-empty': wrapper('wrapper.ctx.response.empty()'),
  'wrapper-status': wrapper('wrapper.ctx.setStatus(201)'),
  'wrapper-branded-body':
    route(`const wrapper={ctx};const response=apiOpenApiHttpResponse('POST:/rpc',original);
    ctx.setStatus(response.status);if(!response.body)ctx.response.empty();else wrapper.ctx.pipeline(response.body)`),
  'wrapper-response': route(`const wrapper={response:ctx.response};
    if(ctx.query.raw)wrapper.response.buffer(raw);else{${dispatch}}`),
  'implicit-wrapper-pipeline': implicit('wrapper.ctx.pipeline(raw)'),
  'implicit-wrapper-buffer': implicit('wrapper.ctx.response.buffer(raw)'),
  'implicit-wrapper-json': implicit('wrapper.ctx.json(raw)'),
  'implicit-wrapper-empty': implicit('wrapper.ctx.response.empty()'),
  'implicit-wrapper-status': implicit('wrapper.ctx.setStatus(201)'),
  'else-wrong-body': route(`const response=apiOpenApiHttpResponse('POST:/rpc',original);
    ctx.setStatus(response.status);if(unrelated.body)ctx.pipeline(response.body);else ctx.response.empty()`),
  'else-negated-body': route(`const response=apiOpenApiHttpResponse('POST:/rpc',original);
    ctx.setStatus(response.status);if(!response.body)ctx.pipeline(response.body);else ctx.response.empty()`),
  'then-positive-body': route(`const response=apiOpenApiHttpResponse('POST:/rpc',original);
    ctx.setStatus(response.status);if(response.body)ctx.response.empty();else ctx.pipeline(response.body)`),
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

describe('HTTP context wrapper safety and positive-body else dispatch', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each([
    'else-direct',
    'else-wrapped',
    'const-context-alias',
    'dead-wrapper',
    'foreign-wrapper',
  ] as const)('extracts complete executable dispatch %s', (name) => {
    const rows = Object.values(discover(name))
    expect(rows.map((row) => row.bodyKind)).toEqual(['content', 'none'])
    expect(rows.every((row) => !row.unavailableReason)).toBe(true)
  })
  it.each([
    'wrapper-pipeline',
    'wrapper-buffer',
    'wrapper-json',
    'wrapper-empty',
    'wrapper-status',
    'wrapper-branded-body',
    'wrapper-response',
    'else-wrong-body',
    'else-negated-body',
    'then-positive-body',
  ] as const)('rejects unsupported dispatch %s in strict and lenient modes', (name) => {
    expect(() => discover(name)).toThrow()
    expect(Object.values(discover(name, true)).some((row) => row.unavailableReason)).toBe(true)
  })
  it.each([
    'implicit-wrapper-pipeline',
    'implicit-wrapper-buffer',
    'implicit-wrapper-json',
    'implicit-wrapper-empty',
    'implicit-wrapper-status',
  ] as const)('retains unmarked wrapper %s as unavailable in both modes', (name) => {
    for (const lenient of [false, true])
      expect(Object.values(discover(name, lenient)).some((row) => row.unavailableReason)).toBe(true)
  })
})
