import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ciReporters } from './vitest-ci-reporters.mts'
import { VitestNoSkipsReporter } from './vitest-no-skips-reporter.mts'

type CompletedModule = Parameters<VitestNoSkipsReporter['onTestRunEnd']>[0][number]
function moduleWithSkipped(count: number): CompletedModule {
  return { children: { allTests: () => Array.from({ length: count }) } }
}

describe('VitestNoSkipsReporter', () => {
  const originalExitCode = process.exitCode
  let write: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.exitCode = undefined
    write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  })
  afterEach(() => {
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
  })

  it('fails the process without rejecting when results are skipped across modules', () => {
    const reporter = new VitestNoSkipsReporter()
    expect(() =>
      reporter.onTestRunEnd([moduleWithSkipped(1), moduleWithSkipped(2)], [], 'passed'),
    ).not.toThrow()
    expect(process.exitCode).toBe(1)
    expect(String(write.mock.calls[0]?.[0])).toContain('3 skipped results')
  })

  it('accepts completed runs without skipped results', () => {
    const reporter = new VitestNoSkipsReporter()
    reporter.onTestRunEnd([moduleWithSkipped(0)], [], 'passed')
    reporter.onTestRunEnd([], [], 'passed')
    expect(process.exitCode).toBeUndefined()
    expect(write).not.toHaveBeenCalled()
  })

  it.each(['failed', 'interrupted'] as const)('preserves an existing %s outcome', (reason) => {
    new VitestNoSkipsReporter().onTestRunEnd([moduleWithSkipped(1)], [], reason)
    expect(process.exitCode).toBeUndefined()
    expect(write).not.toHaveBeenCalled()
  })

  it('preserves an existing unhandled error without a second gate error', () => {
    new VitestNoSkipsReporter().onTestRunEnd(
      [moduleWithSkipped(1)],
      [new Error('primary failure')],
      'passed',
    )
    expect(process.exitCode).toBeUndefined()
    expect(write).not.toHaveBeenCalled()
  })

  it('uses only current run results when reused', () => {
    const reporter = new VitestNoSkipsReporter()
    reporter.onTestRunEnd([moduleWithSkipped(1)], [], 'passed')
    expect(String(write.mock.calls[0]?.[0])).toContain('1 skipped results')
    reporter.onTestRunEnd([moduleWithSkipped(0)], [], 'passed')
    expect(write).toHaveBeenCalledOnce()
  })

  it('runs as a ciReporters extra reporter', () => {
    const gate = new VitestNoSkipsReporter()
    const reporters = ciReporters({ env: { VITEST_CI_REPORTERS: 'run' }, extraReporters: [gate] })
    if (!Array.isArray(reporters)) throw new Error('CI reporter array missing')
    expect(reporters.indexOf(gate)).toBe(reporters.indexOf('junit') + 1)
  })
})
