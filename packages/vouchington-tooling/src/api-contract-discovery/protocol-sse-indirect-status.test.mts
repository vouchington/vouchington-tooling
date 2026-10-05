import { beforeAll, describe, expect, it } from 'vitest'
import { discoverApiResponseContracts } from './response-contract-registry.mts'
import { responseStatusCodesForContract } from './response-contract-status.mts'
import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'

const preamble = `declare const app:any;class Context{setStatus(_status:number):void{}}const other=new Context();
  class Stream{write(_value:string):void{}}const stream=new Stream();
  declare function apiSseFrame<K extends string,T>(key:K,event:T):string;
  function ignore(callback:()=>void){}
  function invoke(callback:()=>void){callback()}`
const frame = `stream.write(apiSseFrame('GET:/events',{event:'done' as const,data:{}}))`
const route = (body: string) => `${preamble}app.route('/events').get((ctx:any)=>{${body};${frame}})`
const invalid = {
  call: 'ctx.setStatus.call(ctx,201)',
  apply: 'ctx.setStatus.apply(ctx,[201])',
  bind: 'ctx.setStatus.bind(ctx)(201)',
  'bound-alias': 'const status=ctx.setStatus.bind(ctx);status(201)',
  'bound-argument': 'const status=ctx.setStatus.bind(ctx,201);status()',
  'method-alias-call': 'const status=ctx.setStatus;status.call(ctx,201)',
  'method-alias-apply': 'const status=ctx.setStatus;status.apply(ctx,[201])',
  'method-alias-bind': 'const status=ctx.setStatus;const bound=status.bind(ctx);bound(201)',
  'context-alias': 'const context=ctx;context.setStatus.call(context,201)',
  'bracket-setter': "ctx['setStatus'].call(ctx,201)",
  'bracket-call': "ctx.setStatus['call'](ctx,201)",
  'bracket-apply': "ctx['setStatus']['apply'](ctx,[201])",
  'bracket-bind': "ctx['setStatus']['bind'](ctx)(201)",
  'nested-bind-call': 'ctx.setStatus.bind.call(ctx.setStatus,ctx,201)()',
  timer: 'setTimeout(()=>ctx.setStatus.call(ctx,201),1)',
  helper: 'invoke(()=>ctx.setStatus.apply(ctx,[201]))',
} as const
const controls = {
  default: '',
  direct: 'ctx.setStatus(201)',
  'direct-bracket': "ctx['setStatus'](201)",
  'dead-call': 'if(false)ctx.setStatus.call(ctx,201)',
  'dead-bind': 'if(false){const status=ctx.setStatus.bind(ctx);status(201)}',
  'ignored-call': 'ignore(()=>ctx.setStatus.call(ctx,201))',
  'ignored-bind': 'ignore(()=>{const status=ctx.setStatus.bind(ctx);status(201)})',
  'uncalled-function': 'function unused(){ctx.setStatus.apply(ctx,[201])}',
  'uncalled-arrow': 'const unused=()=>ctx.setStatus.call(ctx,201)',
  'different-context': 'other.setStatus.call(other,201)',
  'different-alias': 'const status=other.setStatus.bind(other);status(201)',
  generator: 'function* unused(){ctx.setStatus.call(ctx,201)}unused()',
} as const
const sources = Object.fromEntries(
  [...Object.entries(invalid), ...Object.entries(controls)].map(([name, body]) => [
    name,
    route(body),
  ]),
)
sources['suffix-bracket'] = route("ctx['setStatus'](201)").replace(
  'GET:/events',
  'GET:/events#typed',
)
sources['parameter-bracket'] = route("ctx['setStatus'](201)")
  .replace("route('/events')", "route('/events/:id')")
  .replace('GET:/events', 'GET:/events/:id')
let matrix: VirtualProgramMatrix<string>
function discover(name: string, lenient = false) {
  return discoverApiResponseContracts(
    matrix.program,
    [matrix.sourceFile(name)],
    undefined,
    lenient ? { onRouteError: () => {} } : undefined,
  )
}
describe('indirect canonical SSE setters fail closed', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  })
  it.each(Object.keys(invalid))('rejects indirect status %s in both modes', (name) => {
    expect(() => discover(name)).toThrow('indirect status')
    const rows = Object.values(discover(name, true))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.unavailableReason).toContain('indirect status')
  })
  it.each(Object.keys(controls))('preserves actual direct or default status %s', (name) => {
    for (const lenient of [false, true]) {
      const rows = Object.values(discover(name, lenient))
      expect(rows.every((row) => !row.unavailableReason)).toBe(true)
      expect(rows.map(responseStatusCodesForContract)).toEqual([
        [name.startsWith('direct') ? 201 : 200],
      ])
    }
  })
  it.each([
    ['suffix-bracket', 'GET:/events#typed'],
    ['parameter-bracket', 'GET:/events/:eventId'],
  ] as const)('preserves direct bracket status for selected %s', (name, key) => {
    const rows = discoverApiResponseContracts(
      matrix.program,
      [matrix.sourceFile(name)],
      new Set([key]),
    )
    expect(Object.keys(rows)).toEqual([key])
    expect(rows[key]!.unavailableReason).toBeUndefined()
    expect(responseStatusCodesForContract(rows[key]!)).toEqual([201])
  })
})
