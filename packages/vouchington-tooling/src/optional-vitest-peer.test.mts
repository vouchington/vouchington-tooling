import { describe, expect, it } from 'vitest'
import { optionalVitestConsumer } from '../test-helpers/optional-vitest-consumer.mts'

describe('optional Vitest peer at built package entry points', () => {
  it('loads root skill and pure timeout exports without the optional Vitest peer', async () => {
    const result = await optionalVitestConsumer(`
      const { createRequire } = await import('node:module')
      const require = createRequire(import.meta.resolve('vouchington-tooling'))
      try { require.resolve('vitest/config'); throw new Error('VITEST_WAS_NOT_ISOLATED') }
      catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }
      const { linkSkill, assertTestTimeout } = await import('vouchington-tooling')
      if (typeof linkSkill !== 'function' || assertTestTimeout(25, 'case') !== 25)
        throw new Error('ROOT_PUBLIC_API_UNAVAILABLE')
      console.log('ROOT_WITHOUT_VITEST_OK')
    `)
    expect(result.stdout).toContain('ROOT_WITHOUT_VITEST_OK')
    expect(result.stderr).toBe('')
  })

  it('retains both dedicated plugin exports when the optional peer is installed', async () => {
    const result = await optionalVitestConsumer(
      `
      const { testTimeoutPolicyPlugin, browserTestTimeoutPolicyPlugin } =
        await import('vouchington-tooling/test-timeout-policy/plugin')
      if (testTimeoutPolicyPlugin().name !== 'test-timeout-policy' ||
          browserTestTimeoutPolicyPlugin().name !== 'browser-test-timeout-policy')
        throw new Error('DEDICATED_PLUGIN_API_UNAVAILABLE')
      console.log('DEDICATED_PLUGIN_WITH_VITEST_OK')
    `,
      true,
    )
    expect(result.stdout).toContain('DEDICATED_PLUGIN_WITH_VITEST_OK')
    expect(result.stderr).toBe('')
  })
})
