import { describe, expect, it } from 'vitest'
import { ciReporters } from './vitest-ci-reporters.mts'
import { VitestNoSkipsReporter } from './vitest-no-skips-reporter.mts'

type CompletedModule = Parameters<VitestNoSkipsReporter['onTestRunEnd']>[0][number]
function moduleWithSkipped(count: number): CompletedModule {
  return { children: { allTests: () => Array.from({ length: count }) } }
}

describe('VitestNoSkipsReporter', () => {
  it('rejects skipped results across modules', async () => {
    const reporter = new VitestNoSkipsReporter()
    await expect(
      reporter.onTestRunEnd([moduleWithSkipped(1), moduleWithSkipped(2)], [], 'passed'),
    ).rejects.toThrow('3 skipped results')
  })

  it('accepts completed runs without skipped results', async () => {
    const reporter = new VitestNoSkipsReporter()
    await expect(
      reporter.onTestRunEnd([moduleWithSkipped(0)], [], 'passed'),
    ).resolves.toBeUndefined()
    await expect(reporter.onTestRunEnd([], [], 'passed')).resolves.toBeUndefined()
  })

  it.each(['failed', 'interrupted'] as const)(
    'preserves an existing %s outcome',
    async (reason) => {
      const reporter = new VitestNoSkipsReporter()
      await expect(
        reporter.onTestRunEnd([moduleWithSkipped(1)], [], reason),
      ).resolves.toBeUndefined()
    },
  )

  it('preserves an existing unhandled error without a second gate error', async () => {
    const reporter = new VitestNoSkipsReporter()
    await expect(
      reporter.onTestRunEnd([moduleWithSkipped(1)], [new Error('primary failure')], 'passed'),
    ).resolves.toBeUndefined()
  })

  it('uses only current run results when reused', async () => {
    const reporter = new VitestNoSkipsReporter()
    await expect(reporter.onTestRunEnd([moduleWithSkipped(1)], [], 'passed')).rejects.toThrow(
      '1 skipped results',
    )
    await expect(
      reporter.onTestRunEnd([moduleWithSkipped(0)], [], 'passed'),
    ).resolves.toBeUndefined()
  })

  it('runs as a ciReporters extra reporter', async () => {
    const gate = new VitestNoSkipsReporter()
    const reporters = ciReporters({ env: { VITEST_CI_REPORTERS: 'run' }, extraReporters: [gate] })
    if (!Array.isArray(reporters)) throw new Error('CI reporter array missing')
    expect(reporters.indexOf(gate)).toBe(reporters.indexOf('junit') + 1)
    await expect(gate.onTestRunEnd([moduleWithSkipped(1)], [], 'passed')).rejects.toThrow(
      '1 skipped results',
    )
  })
})
