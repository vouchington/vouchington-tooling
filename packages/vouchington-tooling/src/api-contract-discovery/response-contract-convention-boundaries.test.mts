import { beforeAll, describe, expect, it } from 'vitest'

import { buildVirtualProgramMatrix, type VirtualProgramMatrix } from './test-setup.test-helpers.mts'
import { discoverApiResponseContracts } from './response-contract-registry.mts'

const preamble = `declare const app: any; declare const ctx: any;`
const sources = {
  detached: `${preamble} ctx.json({ detached: true })`,
  excluded: `${preamble} app.route('/one').get((ctx: any) => ctx.json({ one: true }))`,
  'xml-empty': `${preamble} app.route('/xml').get((ctx: any) => ctx.response.xml())`,
  'xml-after-json': `${preamble} app.route('/xml').get((ctx: any) => {
    ctx.json({ first: true }); ctx.response.xml('<value/>')
  })`,
  'xml-only': `${preamble} app.route('/xml').get((ctx: any) => ctx.response.xml('<value/>'))`,
  'json-requested': `${preamble} app.route('/one').get((ctx: any) => {
    ctx.json({ first: true }); ctx.json({ second: true })
  })`,
  'json-empty': `${preamble} app.route('/one').get((ctx: any) => {
    ctx.json({ first: true }); ctx.response.empty()
  })`,
  'dynamic-empty': `${preamble} declare const dynamicStatus: number
    app.route('/empty').get((ctx: any) => { ctx.setStatus(dynamicStatus); ctx.response.empty() })`,
  'three-variants': `${preamble} app.route('/variants').get((ctx: any) => {
    if (ctx.a) ctx.json({ a: true })
    if (ctx.b) ctx.json({ b: true })
    ctx.json({ c: true })
  })`,
} as const

let matrix: VirtualProgramMatrix<keyof typeof sources>
function discover(id: keyof typeof sources, requestedKeys?: ReadonlySet<string>) {
  return discoverApiResponseContracts(matrix.program, [matrix.sourceFile(id)], requestedKeys)
}

describe('implicit response discovery boundaries', () => {
  beforeAll(() => {
    matrix = buildVirtualProgramMatrix(import.meta, sources)
  }, 15_000)

  it('ignores an unbound response call and an unrequested route', () => {
    expect(discover('detached')).toEqual({})
    expect(discover('excluded', new Set(['GET:/other']))).toEqual({})
  })

  it('skips an XML response with no body and keeps XML as a secondary route variant', () => {
    expect(discover('xml-empty')).toEqual({})
    const variants = discover('xml-after-json')
    expect(Object.keys(variants)).toEqual(['GET:/xml', 'GET:/xml#implicit-2'])
    expect(variants['GET:/xml#implicit-2']?.mediaType).toBe('application/xml')
    expect(Object.keys(discover('xml-after-json', new Set(['GET:/xml'])))).toEqual(['GET:/xml'])
    expect(discover('xml-only')['GET:/xml']?.mediaType).toBe('application/xml')
  })

  it('keeps only the first unmarked body in subset mode and adds a no-content variant in full mode', () => {
    expect(Object.keys(discover('json-requested', new Set(['GET:/one'])))).toEqual(['GET:/one'])
    expect(Object.keys(discover('json-empty'))).toEqual(['GET:/one', 'GET:/one#implicit-2'])
  })

  it('retains unknown status attribution for an explicit empty response', () => {
    expect(discover('dynamic-empty')['GET:/empty']).toMatchObject({
      bodyKind: 'none',
      statusKnowledge: 'unknown',
      unavailableReason: 'nearest ctx.setStatus value is dynamic',
    })
  })

  it('registers three successive implicit bodies under distinct deterministic keys', () => {
    expect(Object.keys(discover('three-variants'))).toEqual([
      'GET:/variants',
      'GET:/variants#implicit-2',
      'GET:/variants#implicit-3',
    ])
  })
})
