import type {
  FullConfig,
  FullResult,
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter'
import { relative } from 'node:path'

export interface TestLifecycleReporterOptions {
  /**
   * Fail the run when any test ends with status `skipped`. This includes `test.fixme`,
   * `test.skip`, and tests skipped at runtime, because Playwright reports all of them as
   * `skipped`. Defaults to `false`; the caller decides, for example
   * `failOnSkippedTests: Boolean(process.env.CI)`.
   */
  failOnSkippedTests?: boolean
}

export default class TestLifecycleReporter implements Reporter {
  static readonly modulePath = import.meta.filename

  private readonly failOnSkippedTests: boolean
  private readonly skipped: string[] = []
  private rootDir = ''
  private shard: FullConfig['shard'] = null

  constructor(options: TestLifecycleReporterOptions = {}) {
    this.failOnSkippedTests = options.failOnSkippedTests ?? false
  }

  onBegin(config: FullConfig): void {
    this.rootDir = config.rootDir
    this.shard = config.shard
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    this.record('begin', test, result)
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.record('end', test, result)
    if (result.status === 'skipped') {
      const title = test.titlePath().filter(Boolean).join(' > ')
      this.skipped.push(`${title} (${this.relativeFile(test)}:${test.location.line})`)
    }
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    if (!this.failOnSkippedTests || this.skipped.length === 0) return undefined
    const lines = this.skipped.map((entry) => `  - ${entry}`).join('\n')
    process.stderr.write(
      `${this.skipped.length} test(s) were skipped and failOnSkippedTests is enabled:\n${lines}\n`,
    )
    return result.status === 'passed' ? { status: 'failed' } : undefined
  }

  printsToStdio(): boolean {
    return true
  }

  private relativeFile(test: TestCase): string {
    return relative(this.rootDir, test.location.file)
  }

  private record(event: 'begin' | 'end', test: TestCase, result: TestResult): void {
    process.stdout.write(
      `${JSON.stringify({
        marker: 'playwright-test-lifecycle',
        event,
        observedAt: new Date().toISOString(),
        testId: test.id,
        file: this.relativeFile(test),
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
