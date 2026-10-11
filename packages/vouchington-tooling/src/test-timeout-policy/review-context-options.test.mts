import { describe, expect, it } from 'vitest'
import { fixture } from '../../test-helpers/timeout-policy-child.mts'
import { browserFixture } from '../../test-helpers/browser-timeout-child.mts'

describe('public context, options and nested aliases', () => {
  it.each(['onTestFinished', 'onTestFailed'])(
    'guards %s before a custom extension captures its timer',
    async (hook) => {
      const result = await fixture(
        `test('body', continued)`,
        '{ testTimeout: 20, hookTimeout: 20 }',
        `result.${hook}(() => {}, 150)`,
        undefined,
        { policyMaximum: 20 },
      )
      expect(result.code, result.output).toBe(1)
      expect(result.output).toContain('hook timeout must be positive, finite and at most 20 ms')
      expect(result.marker).toBeUndefined()
      expect(result.forcedCleanup).toBe(false)
    },
  )

  it.each(['inherited', 'non-enumerable'])(
    'preserves native registrations when the SDK ignores %s timeout properties',
    async (kind) => {
      const result = await fixture(`
        const options = ${kind === 'inherited' ? 'Object.create({ timeout: 30001 })' : "Object.defineProperty({}, 'timeout', { value: 30001 })"}
        native.test('native control', options, () => {})
        test('guarded default', options, () => {})
        describe('guarded suite default', options, () => test('body', continued))
        const ignored = ${kind === 'inherited' ? "Object.create({ get timeout() { throw new Error('IGNORED_GETTER_READ') } })" : "Object.defineProperty({}, 'timeout', { get() { throw new Error('IGNORED_GETTER_READ') } })"}
        native.test('native ignored getter', ignored, () => {})
        test('guarded ignored getter', ignored, () => {})
      `)
      expect(result.code, result.output).toBe(0)
      expect(result.marker).toBe('continued')
      expect(result.forcedCleanup).toBe(false)
    },
  )

  it('preserves valid hooks on a returned replacement context', async () => {
    const result = await fixture(
      `test('replacement context', context => {
        if (!context.replacement) throw new Error('REPLACEMENT_CONTEXT_LOST')
        try { context.onTestFinished(() => {}, 150); throw new Error('OVERCAP_ACCEPTED') }
        catch (error) { if (!(error instanceof RangeError)) throw error }
        context.onTestFinished(() => writeFileSync('extension.marker', 'finished'), 20)
        continued()
      })`,
      '{ testTimeout: 20, hookTimeout: 20 }',
      `return Object.assign(function(...args) { return Reflect.apply(result, this, args) },
         result, { replacement: true })`,
      undefined,
      { policyMaximum: 20 },
    )
    expect(result.code, result.output).toBe(0)
    expect(result.marker).toBe('continued')
    expect(result.extensionMarker).toBe('finished')
    expect(result.forcedCleanup).toBe(false)
  })

  it('retains native nested TestAPI aliases and their guarded callbacks', async () => {
    const result = await fixture(`
      for (const [nested, direct] of [[test.describe, describe], [test.suite, suite],
          [test.beforeAll, beforeAll], [test.afterAll, afterAll]]) {
        if (nested !== direct) throw new Error('NESTED_ALIAS_IDENTITY_CHANGED')
      }
      const metadata = new WeakMap([[describe, 'suite metadata']])
      if (metadata.get(test.describe) !== 'suite metadata') throw new Error('ALIAS_METADATA_LOST')
      test.beforeAll(() => {}, 20)
      try { test.afterAll(() => {}, 30001); throw new Error('OVERCAP_ACCEPTED') }
      catch (error) { if (!(error instanceof RangeError)) throw error }
      test.describe('nested suite', () => test('body', continued))
    `)
    expect(result.code, result.output).toBe(0)
    expect(result.marker).toBe('continued')
    expect(result.forcedCleanup).toBe(false)
  })

  it('retains a completion-method alias after native multi-hook execution', async () => {
    const result = await fixture(`
      let previous, alias
      test('first', context => {
        previous = context
        alias = context.onTestFinished
        context.onTestFinished(() => {}, 20)
        context.onTestFinished(() => {}, 20)
      })
      test('after native restoration', () => {
        if (previous.onTestFinished !== alias) throw new Error('RESTORED_METHOD_IDENTITY_CHANGED')
        continued()
      })
    `)
    expect(result.code, result.output).toBe(0)
    expect(result.marker).toBe('continued')
    expect(result.forcedCleanup).toBe(false)
  })

  it.each([{ GITHUB_ACTIONS: 'true' }, { AI_AGENT: 'qualification' }])(
    'retains environment-native reporters through actual Browser Mode: %s',
    async (environment) => {
      const result = await browserFixture(
        `test('browser body', () => expect(true).toBe(true))`,
        5000,
        undefined,
        undefined,
        environment,
      )
      expect(result.code, result.output).toBe(0)
      const receipt: { defaults: string[]; resolved: string[] } = JSON.parse(result.reporters)
      expect(receipt.resolved).toEqual([...receipt.defaults, 'lifecycle'])
      if ('GITHUB_ACTIONS' in environment) expect(receipt.defaults).toContain('github-actions')
      else expect(receipt.defaults).toContain('minimal')
      expect(result.forcedCleanup).toBe(false)
    },
  )
})
