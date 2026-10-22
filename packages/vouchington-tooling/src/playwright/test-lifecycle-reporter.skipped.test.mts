import type { FullConfig, FullResult, TestCase, TestResult } from '@playwright/test/reporter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TestLifecycleReporter from './test-lifecycle-reporter.mts'

function createTest(titles: string[], line: number): TestCase {
  return {
    id: `test-${line}`,
    titlePath: () => ['', 'chromium', ...titles],
    location: { file: '/repo/specs/skip.spec.mts', line, column: 1 },
    parent: { project: () => ({ name: 'chromium' }) },
  } as unknown as TestCase
}

function createResult(status: string): TestResult {
  return { retry: 0, workerIndex: 0, parallelIndex: 0, status, duration: 1 } as TestResult
}

async function run(options: { failOnSkippedTests?: boolean } | undefined, status: string) {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  const reporter = new TestLifecycleReporter(options)
  reporter.onBegin({ rootDir: '/repo', shard: null } as FullConfig)
  reporter.onTestEnd(createTest(['a flow'], 7), createResult('skipped'))
  reporter.onTestEnd(createTest(['fixme flow'], 9), createResult('skipped'))
  reporter.onTestEnd(createTest(['ok flow'], 11), createResult('passed'))
  return { result: await reporter.onEnd({ status } as FullResult), stderr: stderr.join('') }
}

describe('TestLifecycleReporter failOnSkippedTests', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing by default', async () => {
    expect(await run(undefined, 'passed')).toEqual({ result: undefined, stderr: '' })
    expect((await run({ failOnSkippedTests: false }, 'passed')).result).toBeUndefined()
  })

  it('fails a passing run and lists skipped titles and locations', async () => {
    const { result, stderr } = await run({ failOnSkippedTests: true }, 'passed')
    expect(result).toEqual({ status: 'failed' })
    expect(stderr).toContain('2 test(s) were skipped')
    expect(stderr).toContain('chromium > a flow (specs/skip.spec.mts:7)')
    expect(stderr).toContain('chromium > fixme flow (specs/skip.spec.mts:9)')
    expect(stderr).not.toContain('ok flow')
  })

  it('keeps an already failed run status', async () => {
    const { result, stderr } = await run({ failOnSkippedTests: true }, 'timedout')
    expect(result).toBeUndefined()
    expect(stderr).toContain('were skipped')
  })

  it('passes when nothing was skipped', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const reporter = new TestLifecycleReporter({ failOnSkippedTests: true })
    reporter.onBegin({ rootDir: '/repo', shard: null } as FullConfig)
    reporter.onTestEnd(createTest(['ok'], 1), createResult('passed'))
    expect(await reporter.onEnd({ status: 'passed' } as FullResult)).toBeUndefined()
  })
})
