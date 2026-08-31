import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runPrepareVitestReportsCommand } from './prepare-vitest-reports.mts'
import { runVitestReportAttemptCommand } from './vitest-report-attempt.mts'

describe('Vitest report command wrappers', () => {
  const roots: string[] = []
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  afterEach(() => {
    vi.unstubAllEnvs()
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    stdout.mockClear()
    stderr.mockClear()
  })

  it('runs the report-attempt adapter and maps Error failures to stderr', () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo')
    vi.stubEnv('GITHUB_SHA', 'a'.repeat(40))
    vi.stubEnv('GITHUB_RUN_ID', '9131')
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '2')
    expect(runVitestReportAttemptCommand(['read', '/missing-report-attempt-root'])).toBe(0)
    expect(stdout).toHaveBeenCalledWith('{}\n')
    expect(
      runVitestReportAttemptCommand([], () => {
        throw new Error('bad attempt')
      }),
    ).toBe(1)
    expect(stderr).toHaveBeenCalledWith('bad attempt\n')
    expect(
      runVitestReportAttemptCommand([], () => {
        throw 'string attempt'
      }),
    ).toBe(1)
    expect(stderr).toHaveBeenCalledWith('string attempt\n')
  })

  it('runs preparation with directories and maps non-Error failures to stderr', () => {
    const root = mkdtempSync(join(tmpdir(), 'vouchington-report-wrapper-'))
    roots.push(root)
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo')
    vi.stubEnv('GITHUB_SHA', 'a'.repeat(40))
    vi.stubEnv('GITHUB_RUN_ID', '9131')
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '2')
    vi.stubEnv(
      'VITEST_REPORT_EXPECTATIONS',
      JSON.stringify({ version: 'vitest-report-expectations:v2', attempt: 2, suites: [] }),
    )
    expect(
      runPrepareVitestReportsCommand([
        join(root, 'primary'),
        join(root, 'fallback'),
        join(root, 'output'),
      ]),
    ).toBe(0)
    expect(
      runPrepareVitestReportsCommand([], () => {
        throw 'bad reports'
      }),
    ).toBe(1)
    expect(stderr).toHaveBeenCalledWith('bad reports\n')
    expect(
      runPrepareVitestReportsCommand([], () => {
        throw new Error('error reports')
      }),
    ).toBe(1)
    expect(stderr).toHaveBeenCalledWith('error reports\n')
  })
})
