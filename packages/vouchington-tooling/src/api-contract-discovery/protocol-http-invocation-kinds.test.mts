import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;
  type Content={status:200;bodyKind:'content';mediaType:'application/json';body:{ok:boolean}}
  type Empty={status:202;bodyKind:'none'}
  type Http<T>=Response & {readonly apiHttpResponseVariants?:T}
  declare function apiOpenApiHttpResponse<K extends string,T>(key:K,response:Http<T>):Http<T>
  declare const both:Http<Content|Empty>;
  declare const content:Http<Content>;
  declare const empty:Http<Empty>;
  function ignore(callback:(context:any)=>void):void {}
  declare function deferred(callback:(context:any)=>void):void;`
const dispatch = (value = 'both') => `const response=apiOpenApiHttpResponse('POST:/rpc',${value});
  context.setStatus(response.status);
  if(!response.body)context.response.empty();else context.pipeline(response.body)`
const route = (body: string) => `${preamble}
  app.route('/rpc').post((context:any)=>{${body}})`
const mixed = (kind: string) =>
  route(dispatch('special')).replace(
    'declare const both:',
    `declare const special:Http<Content|{status:202;${kind}}>; declare const both:`,
  )
const sources = {
  direct: route(dispatch()),
  'called-local': route(`function send(context:any){${dispatch()}};send(context)`),
  immediate: route(`((context:any)=>{${dispatch()}})(context)`),
  'consumed-callback': route(`function invoke(callback:(context:any)=>void){callback(context)};
    invoke((context:any)=>{${dispatch()}})`),
  'mutable-context': route(`let alias=context;${dispatch()}`),
  'destructured-context': route(`const {response:alias}=context;${dispatch()}`),
  'unused-local': route(`function unused(context:any){${dispatch()}}`),
  'unused-arrow': route(`const unused=(context:any)=>{${dispatch()}}`),
  'ignored-callback': route(`ignore((context:any)=>{${dispatch()}})`),
  'deferred-callback': route(`deferred((context:any)=>{${dispatch()}})`),
  'shadowed-unused': route(`function unused(context:any){${dispatch()}};
    {const unused=()=>{};unused()}`),
  'ignored-ancestor': route(`ignore((context:any)=>{
    function send(context:any){${dispatch()}};send(context)
  })`),
  'dead-marker': route(`if(false){${dispatch()}}`),
  'unreachable-marker': route(`return;${dispatch()}`),
  'undeclared-empty': route(dispatch('content')),
  'undeclared-content': route(dispatch('empty')),
  'invalid-unselected-kind': mixed("bodyKind:'invalid'"),
  'broad-unselected-kind': mixed('bodyKind:string'),
  'missing-unselected-kind': mixed('extra:boolean'),
  'ambiguous-unselected-kind': mixed("bodyKind:'content'|'none'"),
  'unselected-unknown-payload': mixed("bodyKind:'content';mediaType:string;body:unknown").replace(
    'if(!response.body)context.response.empty();else context.pipeline(response.body)',
    'context.pipeline(response.body)',
  ),
  'content-only': route(`const response=apiOpenApiHttpResponse('POST:/rpc',content);
    context.setStatus(response.status);context.pipeline(response.body)`),
  'empty-only': route(`const response=apiOpenApiHttpResponse('POST:/rpc',empty);
    context.setStatus(response.status);if(!response.body)context.response.empty()`),
  'missing-empty': route(`const response=apiOpenApiHttpResponse('POST:/rpc',both);
    context.setStatus(response.status);context.pipeline(response.body)`),
  'missing-content': route(`const response=apiOpenApiHttpResponse('POST:/rpc',both);
    context.setStatus(response.status);if(!response.body)context.response.empty()`),
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

describe('HTTP executable invocations and complete declared body kinds', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })

  it.each(['direct', 'called-local', 'immediate', 'consumed-callback'] as const)(
    'accepts executable HTTP dispatch %s',
    (name) => {
      const contracts = Object.values(discover(name))
      expect(contracts.map((contract) => contract.bodyKind)).toEqual(['content', 'none'])
      expect(contracts.map((contract) => contract.statusCodes)).toEqual([[200], [202]])
      expect(contracts.every((contract) => !contract.unavailableReason)).toBe(true)
    },
  )

  it.each([
    'mutable-context',
    'destructured-context',
    'unused-local',
    'unused-arrow',
    'ignored-callback',
    'deferred-callback',
    'shadowed-unused',
    'ignored-ancestor',
    'dead-marker',
    'unreachable-marker',
    'undeclared-empty',
    'undeclared-content',
    'missing-empty',
    'missing-content',
  ] as const)('fails closed for %s in strict and lenient modes', (name) => {
    expect(() => discover(name)).toThrow()
    expect(
      Object.values(discover(name, undefined, true)).some((row) => row.unavailableReason),
    ).toBe(true)
  })

  it.each(['content-only', 'empty-only'] as const)(
    'accepts exactly the declared kind %s',
    (name) => {
      const contracts = Object.values(discover(name))
      expect(contracts).toHaveLength(1)
      expect(contracts[0]!.bodyKind).toBe(name === 'content-only' ? 'content' : 'none')
      expect(contracts[0]!.unavailableReason).toBeUndefined()
    },
  )

  it.each(['POST:/rpc', 'POST:/rpc#protocol-2'])(
    'keeps requested subset %s while verifying the full carrier kinds',
    (key) => {
      const contracts = discover('direct', [key])
      expect(Object.keys(contracts)).toEqual([key])
      expect(contracts[key]!.statusCodes).toEqual([key === 'POST:/rpc' ? 200 : 202])
      expect(contracts[key]!.unavailableReason).toBeUndefined()
    },
  )

  it('does not extract unrequested payload schemas while validating full kinds', () => {
    const contracts = discover('unselected-unknown-payload', ['POST:/rpc'])
    expect(Object.keys(contracts)).toEqual(['POST:/rpc'])
    expect(contracts['POST:/rpc']!.unavailableReason).toBeUndefined()
  })

  it.each([
    'undeclared-empty',
    'undeclared-content',
    'missing-empty',
    'missing-content',
    'invalid-unselected-kind',
    'broad-unselected-kind',
    'missing-unselected-kind',
    'ambiguous-unselected-kind',
  ] as const)('does not hide body-kind mismatch %s by selecting one row', (name) => {
    expect(() => discover(name, ['POST:/rpc'])).toThrow()
    expect(
      Object.values(discover(name, ['POST:/rpc'], true)).some((row) => row.unavailableReason),
    ).toBe(true)
  })
})
