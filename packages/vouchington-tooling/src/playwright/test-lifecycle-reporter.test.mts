import type { FullConfig, TestCase, TestResult } from '@playwright/test/reporter'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TestLifecycleReporter from './test-lifecycle-reporter.mts'

function createTest(projectName: string | undefined): TestCase {
  return {
    id: 'test-1',
    location: { file: '/repo/specs/example.spec.mts', line: 12, column: 1 },
    parent: { project: () => (projectName === undefined ? undefined : { name: projectName }) },
  } as unknown as TestCase
}

function createResult(): TestResult {
  return {
    retry: 1,
    workerIndex: 2,
    parallelIndex: 3,
    status: 'passed',
    duration: 15,
  } as TestResult
}

describe('TestLifecycleReporter', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints a begin line and an end line with the lifecycle marker', () => {
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })
    const reporter = new TestLifecycleReporter()
    reporter.onBegin({ rootDir: '/repo', shard: { current: 1, total: 2 } } as FullConfig)
    reporter.onTestBegin(createTest('chromium'), createResult())
    reporter.onTestEnd(createTest(undefined), createResult())

    expect(reporter.printsToStdio()).toBe(true)
    expect(TestLifecycleReporter.modulePath).toContain('test-lifecycle-reporter.mts')
    expect(lines).toHaveLength(2)

    const begin = JSON.parse(lines[0] ?? '') as Record<string, unknown>
    const end = JSON.parse(lines[1] ?? '') as Record<string, unknown>
    expect(begin).toMatchObject({
      marker: 'playwright-test-lifecycle',
      event: 'begin',
      testId: 'test-1',
      file: 'specs/example.spec.mts',
      line: 12,
      project: 'chromium',
      shard: { current: 1, total: 2 },
      retry: 1,
      workerIndex: 2,
      parallelIndex: 3,
    })
    expect(begin).not.toHaveProperty('status')
    expect(typeof begin['observedAt']).toBe('string')
    expect(end).toMatchObject({
      marker: 'playwright-test-lifecycle',
      event: 'end',
      status: 'passed',
      durationMs: 15,
      shard: { current: 1, total: 2 },
    })
    expect(end).not.toHaveProperty('project')
  })

  it('records a null shard when the run is not sharded', () => {
    const lines: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      lines.push(String(chunk))
      return true
    })
    const reporter = new TestLifecycleReporter()
    reporter.onBegin({ rootDir: '/repo', shard: null } as FullConfig)
    reporter.onTestBegin(createTest('chromium'), createResult())

    const begin = JSON.parse(lines[0] ?? '') as { shard: null }
    expect(begin.shard).toBeNull()
  })
})
