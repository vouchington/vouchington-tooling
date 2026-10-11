import { describe, expect, it } from 'vitest'
import { fixture } from '../../test-helpers/timeout-policy-child.mts'

const inlineAll = '{ testTimeout: 250, hookTimeout: 250, server: { deps: { inline: true } } }'

describe('public SDK review regressions', () => {
  it('preserves inline-all dependency configuration through actual SDK collection', async () => {
    const result = await fixture(`test('body', continued)`, inlineAll)
    expect(result.code, result.output).toBe(0)
    expect(result.marker).toBe('continued')
    expect(result.forcedCleanup).toBe(false)
  })

  it('still guards an inlined package registrar with the inline-all sentinel', async () => {
    const result = await fixture(
      `import 'deadline-helper'; test('body', continued)`,
      inlineAll,
      '',
      {
        preserveSymlinks: false,
        source: `import { beforeAll } from 'vitest'; beforeAll(() => {}, 30001)`,
      },
    )
    expect(result.code).toBe(1)
    expect(result.output).toContain('hook timeout must be positive, finite')
    expect(result.marker).toBeUndefined()
    expect(result.forcedCleanup).toBe(false)
  })

  it('preserves direct new.target in the actual worker-loaded final constructor', async () => {
    const result = await fixture(
      `test('body', continued)`,
      undefined,
      '',
      undefined,
      {},
      { assertDirectNewTarget: true },
    )
    expect(result.code, result.output).toBe(0)
    expect(result.lifecycle).toBe('final constructor initialized')
    expect(result.marker).toBe('continued')
    expect(result.forcedCleanup).toBe(false)
  })

  it.each(['beforeAll', 'afterAll'])(
    'rejects the raw collector.%s hook path before an unbounded hook can start',
    async (hook) => {
      const result = await fixture(
        `
        const collector = describe('owned suite', () => test('body', continued))
        collector.on('${hook}', async () => {
          await new Promise(resolve => setTimeout(resolve, 150))
          console.log('RAW_HOOK_EXECUTED')
        })
      `,
        '{ testTimeout: 250, hookTimeout: 20 }',
      )
      expect(result.code).toBe(1)
      expect(result.output).toContain('SuiteCollector.on bypasses native hook deadlines')
      expect(result.output).not.toContain('RAW_HOOK_EXECUTED')
      expect(result.marker).toBeUndefined()
      expect(result.forcedCleanup).toBe(false)
    },
  )

  it('preserves returned collector test, task and clear APIs during native collection', async () => {
    const result = await fixture(`
      const collector = describe('owned suite', () => beforeAll(() => {}))
      collector.test('removed', () => { throw new Error('CLEARED_TEST_EXECUTED') })
      collector.clear()
      collector.test('retained', continued)
      collector.task('retained task', { handler: continued })
    `)
    expect(result.code, result.output).toBe(0)
    expect(result.marker).toBe('continued')
    expect(result.output).not.toContain('CLEARED_TEST_EXECUTED')
    expect(result.forcedCleanup).toBe(false)
  })

  it('uses the configured native deadline for guarded public hooks inside the suite factory', async () => {
    const result = await fixture(
      `describe('owned suite', () => {
      beforeAll(async () => { await new Promise(resolve => setTimeout(resolve, 150)) })
      test('body', continued)
    })`,
      '{ testTimeout: 250, hookTimeout: 20 }',
    )
    expect(result.code).toBe(1)
    expect(result.output).toContain('Hook timed out in 20ms')
    expect(result.marker).toBeUndefined()
    expect(result.forcedCleanup).toBe(false)
  })

  it('preserves guarded suite-factory hooks with the configured native deadline', async () => {
    const result = await fixture(
      `describe('owned suite', () => {
      beforeAll(() => {})
      afterAll(() => {})
      test('body', continued)
    })`,
      '{ testTimeout: 250, hookTimeout: 20 }',
    )
    expect(result.code, result.output).toBe(0)
    expect(result.marker).toBe('continued')
    expect(result.forcedCleanup).toBe(false)
  })
})
