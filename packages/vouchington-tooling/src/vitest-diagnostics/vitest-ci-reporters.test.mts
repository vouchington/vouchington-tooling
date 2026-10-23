import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ciOutputFile, ciReporters, type VitestReporter } from './vitest-ci-reporters.mts'
import { isFileProgressReporter } from './vitest-file-progress-reporter.mts'
import {
  githubActionsReporter,
  normalizeGithubActionsPath,
} from './vitest-github-actions-reporter.mts'

function list(env: Record<string, string | undefined>, extra = {}): unknown[] {
  const reporters = ciReporters({ env, ...extra })
  if (!Array.isArray(reporters)) throw new Error('expected reporter list')
  return reporters
}

describe('ciReporters', () => {
  it.each([undefined, ''])('returns defaults for %j without diagnostics', (configured) => {
    expect(ciReporters({ env: { VITEST_CI_REPORTERS: configured } })).toBeUndefined()
  })

  it.each([undefined, ''])('adds file progress locally for %j with diagnostics', (configured) => {
    const reporters = list({ VITEST_CI_REPORTERS: configured, VITEST_DIAGNOSTICS: '1' })
    expect(reporters[0]).toBe('default')
    expect(reporters.filter(isFileProgressReporter)).toHaveLength(1)
  })

  it('builds the run set and appends progress only when requested', () => {
    const base = { VITEST_CI_REPORTERS: 'run' }
    const baseline = list(base)
    expect(baseline.slice(0, 1)).toEqual(['minimal'])
    expect(baseline).toContain('junit')
    expect(baseline.at(-1)).toBe('hanging-process')
    expect(list({ ...base, VITEST_DIAGNOSTICS: '0' })).toHaveLength(baseline.length)
    expect(list({ ...base, VITEST_DIAGNOSTICS: '1' })).toHaveLength(baseline.length + 1)
    const dir = mkdtempSync(path.join(tmpdir(), 'ci-reporters-'))
    const file = path.join(dir, 'p.log')
    const buffered = list({ ...base, VITEST_FILE_PROGRESS_FILE: file })
    expect(buffered).toHaveLength(baseline.length + 1)
    expect(
      list({ ...base, VITEST_FILE_PROGRESS_FILE: file, VITEST_DIAGNOSTICS: '1' }),
    ).toHaveLength(baseline.length + 2)
  })

  it('adds storybook progress and extra reporters after junit', () => {
    const extra = { name: 'extra' } as unknown as VitestReporter
    const baseline = list({ VITEST_CI_REPORTERS: 'run' })
    const reporters = list(
      { VITEST_CI_REPORTERS: 'run', VITEST_STORYBOOK_BROWSER: '1' },
      { extraReporters: [extra], storybookProgressPrefix: '[sb]', cwd: '/repo' },
    )
    expect(reporters).toHaveLength(baseline.length + 2)
    expect(reporters[reporters.indexOf('junit') + 1]).toBe(extra)
  })

  it('reads custom env names and passes the file progress prefix', () => {
    const reporters = list(
      { MY_MODE: 'run', MY_DIAG: '1' },
      { envNames: { reporters: 'MY_MODE', diagnostics: 'MY_DIAG' }, fileProgressPrefix: '[x]' },
    )
    expect(reporters.filter(isFileProgressReporter)).toHaveLength(1)
  })

  it('rejects unknown reporter sets naming the env var', () => {
    expect(() => ciReporters({ env: { VITEST_CI_REPORTERS: 'nope' } })).toThrow(
      'Unknown VITEST_CI_REPORTERS value "nope". Accepted value: run.',
    )
    expect(() => ciReporters({ env: { MODE: 'nope' }, envNames: { reporters: 'MODE' } })).toThrow(
      'Unknown MODE value',
    )
  })

  it('defaults to process.env', () => {
    expect(() => ciReporters()).not.toThrow()
    expect(() => ciOutputFile()).not.toThrow()
  })
})

describe('ciOutputFile', () => {
  it('maps the junit env var to an output file', () => {
    expect(ciOutputFile({ env: {} })).toBeUndefined()
    expect(ciOutputFile({ env: { VITEST_JUNIT_OUTPUT_FILE: 'out.xml' } })).toEqual({
      junit: 'out.xml',
    })
    expect(ciOutputFile({ env: { J: 'a.xml' }, envNames: { junitOutputFile: 'J' } })).toEqual({
      junit: 'a.xml',
    })
  })
})

describe('normalizeGithubActionsPath', () => {
  const options = { env: { GITHUB_WORKSPACE: '/ws' }, cwd: '/cwd' }

  it('relativizes paths under the workspace or cwd', () => {
    expect(normalizeGithubActionsPath('/ws/a/b.ts', options)).toBe('a/b.ts')
    expect(normalizeGithubActionsPath('/cwd/c.ts', options)).toBe('c.ts')
    expect(normalizeGithubActionsPath('\\ws\\d.ts', options)).toBe('d.ts')
  })

  it('leaves outside absolute paths and parent-relative paths unchanged', () => {
    expect(normalizeGithubActionsPath('/other/x.ts', options)).toBe('/other/x.ts')
    expect(normalizeGithubActionsPath('../y.ts', options)).toBe('../y.ts')
    expect(normalizeGithubActionsPath('z.ts', { cwd: '/cwd', env: {} })).toBe('z.ts')
  })

  it('defaults to process.env and process.cwd()', () => {
    expect(normalizeGithubActionsPath(path.join(process.cwd(), 'q.ts'))).toBe('q.ts')
  })
})

describe('githubActionsReporter', () => {
  it('wires path normalization and job summary links', () => {
    const env = { GITHUB_WORKSPACE: '/ws', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc' }
    const [name, config] = githubActionsReporter({ env, cwd: '/cwd' }) as [
      string,
      { onWritePath: (p: string) => string; jobSummary: unknown },
    ]
    expect(name).toBe('github-actions')
    expect(config.onWritePath('/ws/a.ts')).toBe('a.ts')
    expect(config.jobSummary).toEqual({
      enabled: false,
      fileLinks: { repository: 'o/r', commitHash: 'abc', workspacePath: '/ws' },
    })
    expect(githubActionsReporter()[0]).toBe('github-actions')
  })
})
