import { assertClientOptimizerClosure } from '../../test-helpers/browser-optimizer-receipt.mts'
import { describe, expect, it } from 'vitest'
import { browserFixture } from '../../test-helpers/browser-timeout-child.mts'

describe('actual Browser Mode routing contracts', () => {
  it('routes the SDK tester constructor and preserves browser body/context execution', async () => {
    const result = await browserFixture(`test('body', ({ expect }) => { expect(2 + 2).toBe(4) })`)
    expect(result.code, result.output).toBe(0)
    expect(result.forcedCleanup).toBe(false)
    const routes = result.routing
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      routes.some(
        (route) =>
          route.importer?.includes('tester-') && route.id === '\0test-timeout-policy:vitest',
      ),
    ).toBe(true)
    assertClientOptimizerClosure(result.optimizer, ['vitest', '@vitest/browser'], 'case.test.mts')
  })

  it('rejects browser constructor config before test body', async () => {
    const result = await browserFixture(
      `test('must not execute', () => { throw new Error('BODY_EXECUTED') })`,
      30001,
    )
    expect(result.code).toBe(1)
    expect(result.output).toContain('testTimeout must be positive, finite')
    expect(result.output).not.toContain('BODY_EXECUTED')
    expect(result.forcedCleanup).toBe(false)
  })

  it('rejects aliased runtime config before body continuation', async () => {
    const result = await browserFixture(`test('runtime', () => {
      const setter = vi.setConfig.bind(vi)
      setter({ testTimeout: 30001 })
      throw new Error('BODY_CONTINUED')
    })`)
    expect(result.code).toBe(1)
    expect(result.output).toContain('testTimeout must be positive, finite')
    expect(result.output).not.toContain('BODY_CONTINUED')
    expect(result.forcedCleanup).toBe(false)
  })

  it('routes a package registrar before native hook timeout capture', async () => {
    const result = await browserFixture(
      `import 'browser-registrar'; test('body', () => { throw new Error('BODY_EXECUTED') })`,
      250,
      `import { beforeAll as hook } from 'vitest'; hook(() => {}, 30001)`,
    )
    expect(result.code).toBe(1)
    expect(result.output).toContain('hook timeout must be positive, finite')
    expect(result.output).not.toContain('BODY_EXECUTED')
    expect(result.forcedCleanup).toBe(false)
  })
})
