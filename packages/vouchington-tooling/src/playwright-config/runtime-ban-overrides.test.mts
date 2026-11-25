import { describe, expect, it } from 'vitest'
import { runFixture } from './runtime-fixture.test-helpers.mts'

const overrideForbidden = /overrides are forbidden by the 30,000 ms test cap/

describe('Playwright timeout guard with banOverrides', () => {
  it.each([
    ['under-cap test setter', 'test.setTimeout(5000)'],
    ['ceiling test setter', 'test.setTimeout(30000)'],
    ['under-cap info setter', 'info.setTimeout(5000)'],
    ['test.info() setter', 'test.info().setTimeout(10000)'],
    ['aliased test setter', 'const set = test.setTimeout; set(5000)'],
    ['bound info setter', 'const set = info.setTimeout.bind(info); set(5000)'],
  ])('rejects %s before continuing the body', async (_name, body) => {
    const result = await runFixture(body, { banOverrides: true })
    expect(result.code).toBe(1)
    expect(result.stats?.unexpected).toBe(1)
    expect(result.output).toMatch(overrideForbidden)
    expect(result.marker).toBeUndefined()
  })

  it.each([
    ['beforeEach info setter', 'test.beforeEach(async ({}, info) => { info.setTimeout(5000) })'],
    [
      'beforeAll info setter',
      `test.beforeAll(async ({}, info) => { protectHookTimeouts(info); info.setTimeout(5000) })`,
    ],
    [
      'afterAll info setter',
      `test.afterAll(async ({}, info) => { protectHookTimeouts(info); info.setTimeout(5000) })`,
    ],
  ])('rejects %s when banOverrides is enabled', async (_name, collection) => {
    const result = await runFixture('', { banOverrides: true, collection })
    expect(result.code).toBe(1)
    expect(result.stats?.unexpected).toBe(1)
    expect(result.output).toMatch(overrideForbidden)
  })

  it.each([
    ['collection test setter', 'test.setTimeout(5000)'],
    ['descendant test setter', 'const child = test.extend({}); child.setTimeout(5000)'],
    ['suite timeout override', 'test.describe.configure({ timeout: 5000 })'],
    [
      'suite ceiling timeout override',
      'test.describe.configure({ mode: "serial", timeout: 30000 })',
    ],
  ])('rejects %s during collection', async (_name, collection) => {
    const result = await runFixture('', { banOverrides: true, collection })
    expect(result.code).toBe(1)
    expect(result.output).toMatch(overrideForbidden)
    expect(result.marker).toBeUndefined()
  })

  it('still allows non-timeout describe.configure and legal fixture tuple timeouts', async () => {
    const result = await runFixture('', {
      banOverrides: true,
      collection: `
        test.describe.configure({ mode: 'serial' })
        const child = test.extend({ sample: [async ({}, use) => await use('ok'), { timeout: 10000 }] })
        child('fixture tuple stays capped', async ({ sample }) => {
          if (sample !== 'ok') throw new Error('fixture value lost')
        })
      `,
    })
    expect(result.code).toBe(0)
    expect(result.stats).toMatchObject({ expected: 2, unexpected: 0 })
    expect(result.marker).toBe('continued')
  })
})
