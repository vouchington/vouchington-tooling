import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { writeVitestBlobManifest } from './index.mts'
import { runPrepareVitestReportsCli } from './reports-cli.mts'
import { runVitestReportAttemptCli } from './report-attempt-cli.mts'

const identity = {
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '9131',
  GITHUB_RUN_ATTEMPT: '2',
} as const

describe('Vitest report CLI adapters', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function root(): string {
    const directory = mkdtempSync(join(tmpdir(), 'vouchington-vitest-report-cli-'))
    roots.push(directory)
    return directory
  }

  it.each(['02', '2.0', ' 2', '2 ', '0x2', '1e0', '0', '-2', 'NaN', '9007199254740992'])(
    'rejects non-canonical GitHub run attempt %j in both report commands',
    (attempt) => {
      expect(() =>
        runVitestReportAttemptCli(['read', join(root(), 'markers')], {
          ...identity,
          GITHUB_RUN_ATTEMPT: attempt,
        }),
      ).toThrow('GITHUB_RUN_ATTEMPT must be a positive integer')
      expect(() =>
        runPrepareVitestReportsCli([], {
          ...identity,
          GITHUB_RUN_ATTEMPT: attempt,
        }),
      ).toThrow('GITHUB_RUN_ATTEMPT must be a positive integer')
    },
  )

  it.each(['1', '2', '9007199254740991'])(
    'accepts canonical GitHub run attempt %s in both report commands',
    (attempt) => {
      const directory = root()
      const env = {
        ...identity,
        GITHUB_RUN_ATTEMPT: attempt,
        VITEST_REPORT_EXPECTATIONS: JSON.stringify({
          version: 'vitest-report-expectations:v2',
          attempt: Number(attempt),
          suites: [],
        }),
      }
      runVitestReportAttemptCli(['write', join(directory, 'markers'), 'tooling'], env)
      runPrepareVitestReportsCli(
        [join(directory, 'primary'), join(directory, 'fallback'), join(directory, 'output')],
        env,
      )
    },
  )

  it('writes and reads strict report-attempt markers with required GitHub identity', () => {
    const directory = join(root(), 'markers')
    runVitestReportAttemptCli(['write', directory, 'tooling'], identity)
    const lines: string[] = []
    runVitestReportAttemptCli(['read', directory], identity, (line) => lines.push(line))
    expect(lines).toEqual(['{"tooling":2}'])
    expect(() => runVitestReportAttemptCli(['write', directory], identity)).toThrow('Usage')
    expect(() => runVitestReportAttemptCli(['read', directory, 'tooling'], identity)).toThrow(
      'Usage',
    )
    expect(() => runVitestReportAttemptCli(['invalid', directory], identity)).toThrow('Usage')
    expect(() =>
      runVitestReportAttemptCli(['read', directory], { ...identity, GITHUB_SHA: '' }),
    ).toThrow('GITHUB_SHA is required')
  })

  it('validates sorted expectation floors and reports deterministic selections', () => {
    const directory = root()
    const primary = join(directory, 'primary')
    const fallback = join(directory, 'fallback')
    const output = join(directory, 'output')
    const bundle = join(fallback, 'vitest-blob-tooling')
    mkdirSync(primary)
    writeFileSync(join(primary, '.invalid-tooling'), 'invalid archive\n')
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'tooling.json'), '{}')
    writeVitestBlobManifest(bundle, {
      repository: identity.GITHUB_REPOSITORY,
      revision: identity.GITHUB_SHA,
      runAttempt: 2,
      runId: identity.GITHUB_RUN_ID,
      suite: 'tooling',
    })
    const env = {
      ...identity,
      VITEST_REPORT_EXPECTATIONS: JSON.stringify({
        version: 'vitest-report-expectations:v2',
        attempt: 2,
        suites: [{ suite: 'tooling', minimumAttempt: 2 }],
      }),
    }
    const lines: string[] = []
    runPrepareVitestReportsCli([primary, fallback, output], env, (line) => lines.push(line))
    expect(lines).toEqual([
      '::warning::Rejected Vitest primary report source: invalid-archive',
      'Selected Vitest report tooling from attempt 2 (fallback)',
    ])
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    runPrepareVitestReportsCli([primary, fallback, join(directory, 'default-output')], env)
    expect(stdout).toHaveBeenCalledWith(
      'Selected Vitest report tooling from attempt 2 (fallback)\n',
    )
    stdout.mockRestore()
    expect(() =>
      runPrepareVitestReportsCli([primary, fallback, output], {
        ...env,
        VITEST_REPORT_EXPECTATIONS: JSON.stringify({
          version: 'vitest-report-expectations:v2',
          attempt: 2,
          suites: [{ suite: 'tooling', minimumAttempt: 3 }],
        }),
      }),
    ).toThrow('invalid schema')
    expect(() =>
      runPrepareVitestReportsCli([primary, fallback, output], {
        ...env,
        VITEST_REPORT_EXPECTATIONS: '[]',
      }),
    ).toThrow('must be an object')
    expect(() =>
      runPrepareVitestReportsCli([primary, fallback, output], {
        ...env,
        VITEST_REPORT_EXPECTATIONS: JSON.stringify({
          version: 'vitest-report-expectations:v2',
          attempt: 2,
          suites: [
            { suite: 'tooling', minimumAttempt: 1 },
            { suite: 'backend-shard-1', minimumAttempt: 1 },
          ],
        }),
      }),
    ).toThrow('unique and sorted')
    expect(() => runPrepareVitestReportsCli([primary, fallback, output, 'extra'], env)).toThrow(
      'at most three',
    )
    expect(() =>
      runPrepareVitestReportsCli([primary, fallback, output], {
        ...env,
        GITHUB_RUN_ATTEMPT: '0',
      }),
    ).toThrow('positive integer')
    expect(() =>
      runPrepareVitestReportsCli([primary, fallback, output], {
        ...env,
        GITHUB_RUN_ATTEMPT: '',
      }),
    ).toThrow('GITHUB_RUN_ATTEMPT is required')
  })
})
