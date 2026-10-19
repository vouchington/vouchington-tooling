import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter'
import { relative } from 'node:path'

export default class TestLifecycleReporter implements Reporter {
  static readonly modulePath = import.meta.filename

  private rootDir = ''
  private shard: FullConfig['shard'] = null

  onBegin(config: FullConfig): void {
    this.rootDir = config.rootDir
    this.shard = config.shard
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    this.record('begin', test, result)
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.record('end', test, result)
  }

  printsToStdio(): boolean {
    return true
  }

  private record(event: 'begin' | 'end', test: TestCase, result: TestResult): void {
    process.stdout.write(
      `${JSON.stringify({
        marker: 'playwright-test-lifecycle',
        event,
        observedAt: new Date().toISOString(),
        testId: test.id,
        file: relative(this.rootDir, test.location.file),
        line: test.location.line,
        project: test.parent.project()?.name,
        shard: this.shard,
        retry: result.retry,
        workerIndex: result.workerIndex,
        parallelIndex: result.parallelIndex,
        ...(event === 'end' ? { status: result.status, durationMs: result.duration } : {}),
      })}\n`,
    )
  }
}
