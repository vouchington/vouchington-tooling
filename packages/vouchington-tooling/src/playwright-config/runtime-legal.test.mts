import { describe, expect, it } from 'vitest'
import { capError, guardPath, runFixture } from './runtime-fixture.test-helpers.mts'

describe('Playwright public timeout runtime, legal use', () => {
  it.each([
    ['test', 30_000],
    ['worker', 30_000],
    ['test', undefined],
    ['worker', undefined],
  ] as const)('preserves legal %s fixture tuple timeout %s', async (scope, timeout) => {
    const result = await runFixture('', {
      collection: `
        const options = { scope: ${JSON.stringify(scope)}, timeout: ${String(timeout)} }
        const child = test.extend({ sample: [async ({}, use) => await use('fixture'), options] })
        child('legal tuple fixture', async ({ sample }) => {
          if (sample !== 'fixture') throw new Error('fixture value lost')
        })`,
    })
    expect(result.code).toBe(0)
    expect(result.stats).toMatchObject({ expected: 2, unexpected: 0 })
    expect(result.marker).toBe('continued')
  })

  it.each(['30000', 'undefined'])(
    'forwards a captured accessor timeout %s without re-reading or mutating input',
    async (initial) => {
      const result = await runFixture('', {
        collection: `
          let reads = 0
          let original
          const options = Object.freeze({
            get timeout() { reads++; return reads === 1 ? ${initial} : 30001 },
            get scope() { if (this !== original) throw new Error('receiver changed'); return 'test' }
          })
          original = options
          const tuple = Object.freeze([async ({}, use) => await use('fixture'), options])
          const child = test.extend({ sample: tuple })
          child('captured accessor fixture', async ({ sample }) => {
            if (reads !== 1) throw new Error('options read incorrectly')
            if (sample !== 'fixture' || tuple[1] !== options || !Object.isFrozen(options)) throw new Error('input changed')
          })`,
      })
      expect(result.code).toBe(0)
      expect(result.stats).toMatchObject({ expected: 2, unexpected: 0 })
    },
  )

  it('preserves shared fixture identity through native mergeTests', async () => {
    const result = await runFixture('', {
      collection: `
        const { mergeTests } = await import('@playwright/test')
        let overrides = 0
        const base = test.extend({ sample: async ({}, use) => await use('base') })
        const shared = { data: NaN, sample: async ({ sample }, use) => { overrides++; await use(sample + '/child') } }
        const combined = mergeTests(base.extend(shared), base.extend(shared))
        combined('shared override', async ({ sample, data }) => {
          if (!Number.isNaN(data) || sample !== 'base/child' || overrides !== 1) throw new Error('shared fixture duplicated')
        })`,
    })
    expect(result.code).toBe(0)
    expect(result.stats).toMatchObject({ expected: 2, unexpected: 0 })
  })

  it('rejects changed fixture input instead of trusting a stale shared snapshot', async () => {
    const result = await runFixture('', {
      collection: `
        const shared = { sample: [async ({}, use) => await use('fixture'), { timeout: 30000 }] }
        test.extend(shared)
        shared.sample[1].timeout = 30001
        test.extend(shared)`,
    })
    expect(result.code).toBe(1)
    expect(result.output).toMatch(/RangeError/)
    expect(result.marker).toBeUndefined()
  })

  it.each(['30000', 'undefined'])(
    'captures configure accessor timeout %s at the real test slot',
    async (initial) => {
      const result = await runFixture(
        `if (reads !== 1 || info.timeout !== 30000) throw new Error('suite deadline not captured')`,
        {
          collection: `
        let reads = 0
        const options = Object.freeze({ get timeout() { reads++; return reads === 1 ? ${initial} : 30001 } })
        test.describe.configure(options)`,
        },
      )
      expect(result.code).toBe(0)
      expect(result.stats).toMatchObject({ expected: 1, unexpected: 0 })
    },
  )

  it.each([
    ['beforeAll', 'info.setTimeout(30001)'],
    ['afterAll', 'info.setTimeout(30001)'],
    ['beforeAll', 'info.slow()'],
    ['afterAll', 'info.slow()'],
  ] as const)('rejects %s %s before continuing the hook', async (hook, action) => {
    const result = await runFixture('', {
      collection: `test[${JSON.stringify(hook)}]('owned cap hook', async ({}, info) => {
          protectHookTimeouts(info)
          ${action}
          writeFileSync('hook.marker', 'continued')
        })`,
    })
    expect(result.code).toBe(1)
    expect(result.stats?.unexpected).toBe(1)
    expect(result.output).toMatch(capError)
    expect(result.hookMarker).toBeUndefined()
  })

  it('preserves named all-hook fixtures, ordering and legal hook deadlines', async () => {
    const result = await runFixture('', {
      extended: true,
      workerFixture: true,
      collection: `
        const seen = []
        test.beforeAll('owned setup', async ({ sample }, info) => {
          protectHookTimeouts(info)
          if (sample !== 'fixture') throw new Error('worker fixture lost')
          info.setTimeout(25000)
          seen.push('before')
        })
        test.afterAll('owned teardown', async ({ sample }, info) => {
          protectHookTimeouts(info)
          if (sample !== 'fixture' || seen.join() !== 'before') throw new Error('hook context lost')
          info.setTimeout(30000)
          writeFileSync('hook.marker', 'completed')
        })`,
    })
    expect(result.code).toBe(0)
    expect(result.stats).toMatchObject({ expected: 1, unexpected: 0 })
    expect(result.hookMarker).toBe('completed')
  })

  it.each(['beforeAll', 'afterAll'] as const)(
    'reports the original %s declaration on an actual hook timeout',
    async (phase) => {
      const result = await runFixture('', {
        collection: `test[${JSON.stringify(phase)}]('owned timeout location', async ({}, info) => {
            protectHookTimeouts(info)
            info.setTimeout(25)
            await new Promise(() => {})
          })`,
      })
      expect(result.code).toBe(1)
      expect(result.stats?.unexpected).toBe(1)
      const failure = result.errors.find((error) => error.location?.file.endsWith('tiny.spec.mts'))
      expect(failure?.location?.file).not.toBe(guardPath)
      const declaration =
        result.specSource
          .split('\n')
          .findIndex((line) => line.includes(`]('owned timeout location', async`)) + 1
      expect(failure?.location?.line).toBe(declaration)
      expect(result.output).toMatch(/hook timeout.*exceeded/i)
    },
  )

  it('runs legal public setters and extended fixtures at the CLI ceiling', async () => {
    const result = await runFixture(
      `
    test.setTimeout(30000)
    const setter = info.setTimeout.bind(info)
    setter(25000)
    if (sample !== 'fixture') throw new Error('extended fixture lost')
    if (test.info() !== info) throw new Error('different public info instance')
  `,
      { cliTimeout: '30000', extended: true },
    )
    expect(result.code).toBe(0)
    expect(result.marker).toBe('continued')
    expect(result.stats).toMatchObject({ expected: 1, unexpected: 0 })
  })
})
