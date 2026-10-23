import { describe, expect, it } from 'vitest'

import { makeAttemptEnv, storybookBrowserAttemptCacheDir } from './env.mts'
import {
  commandArgs,
  envName,
  parsePositiveInteger,
  resolveProject,
  resolveRunnerOptions,
} from './options.mts'
import { parseStorybookBrowserRunnerArgs } from './args.mts'

describe('parsePositiveInteger', () => {
  it('accepts positive safe integers and otherwise falls back', () => {
    expect(parsePositiveInteger('42', 1)).toBe(42)
    for (const bad of [undefined, '', '0', '-3', '1.5', 'x', '9007199254740993'])
      expect(parsePositiveInteger(bad, 7)).toBe(7)
  })
})

describe('resolveProject', () => {
  it('fills defaults from the project name', () => {
    expect(resolveProject({ projectName: ' ui ' })).toEqual({
      args: ['exec', 'vitest', 'run', '--project', 'ui'],
      command: 'pnpm',
      completionFile: undefined,
      coverageArgs: ['--coverage'],
      envPrefix: 'STORYBOOK_BROWSER',
      optimizeDepsGuidance: 'Add them to the Storybook Vite optimizeDeps include list.',
      progressPrefix: '[vitest-browser-progress]',
      projectName: 'ui',
      resultFiles: [],
    })
  })

  it('keeps explicit values and names the optimizeDeps config', () => {
    const project = resolveProject({
      args: ['a'],
      command: 'node',
      completionFile: 'done.json',
      coverageArgs: [],
      envPrefix: 'X',
      optimizeDepsConfigPath: 'o.mts',
      progressPrefix: '[p]',
      projectName: 'ui',
      resultFiles: ['r'],
    })
    expect(project).toMatchObject({ args: ['a'], command: 'node', completionFile: 'done.json' })
    expect(project.optimizeDepsGuidance).toBe('Add them to the optimizeDeps list in o.mts.')
  })

  it('rejects an empty project name', () => {
    expect(() => resolveProject({ projectName: '  ' })).toThrow('projectName must be')
  })
})

describe('resolveRunnerOptions', () => {
  const project = resolveProject({ projectName: 'ui' })

  it('uses the defaults', () => {
    expect(resolveRunnerOptions(project, {})).toEqual({
      attempts: 3,
      diagnosticsFile: 'storybook-browser-diagnostics.log',
      hangMs: 120_000,
      sessionBudgetMs: 300_000,
      stallMs: 30_000,
      terminationGraceMs: 5000,
    })
  })

  it('reads prefixed env vars, caps attempts at three and the grace at the budget', () => {
    const custom = resolveProject({ envPrefix: 'SB', projectName: 'ui' })
    expect(
      resolveRunnerOptions(custom, {
        SB_DIAGNOSTICS_FILE: 'd.log',
        SB_HANG_MS: '10',
        SB_OPTIMIZER_STALL_MS: '20',
        SB_SESSION_BUDGET_MS: '1000',
        SB_STARTUP_ATTEMPTS: '8',
        STORYBOOK_BROWSER_HANG_MS: '99',
      }),
    ).toEqual({
      attempts: 3,
      diagnosticsFile: 'd.log',
      hangMs: 10,
      sessionBudgetMs: 1000,
      stallMs: 20,
      terminationGraceMs: 500,
    })
    expect(envName(custom, 'X')).toBe('SB_X')
  })
})

describe('commandArgs', () => {
  it('appends the coverage args unless coverage is disabled', () => {
    const project = resolveProject({ coverageArgs: ['--coverage', '--c8'], projectName: 'ui' })
    expect(commandArgs(project, {})).toEqual([
      'exec',
      'vitest',
      'run',
      '--project',
      'ui',
      '--coverage',
      '--c8',
    ])
    expect(commandArgs(project, { STORYBOOK_BROWSER_COVERAGE: '0' })).toEqual([
      'exec',
      'vitest',
      'run',
      '--project',
      'ui',
    ])
  })
})

describe('makeAttemptEnv', () => {
  it('bounds the debug namespaces and sets the Storybook browser env', () => {
    const env = makeAttemptEnv(
      'ui',
      {
        DEBUG: 'foo, pw:protocol*,-pw:protocol,vite:deps',
        VITEST_STORYBOOK_BROWSER_API_PORT: '5000',
      },
      3,
      '/repo',
    )
    expect(env.DEBUG).toBe(
      'foo,vite:deps,-pw:protocol*,vitest:browser:playwright,vitest:browser:api',
    )
    expect(env).toMatchObject({
      STORYBOOK_DISABLE_TELEMETRY: '1',
      VITEST_COVERAGE_SCOPE: 'ui',
      VITEST_PW_DEBUG: '1',
      VITEST_STORYBOOK_BROWSER: '1',
      VITEST_STORYBOOK_BROWSER_API_PORT: String(5000 + 2 * 137),
    })
  })

  it('keeps retry API ports inside the TCP range', () => {
    const port = (value: string, attempt: number) =>
      Number(
        makeAttemptEnv('ui', { VITEST_STORYBOOK_BROWSER_API_PORT: value }, attempt, '/r')
          .VITEST_STORYBOOK_BROWSER_API_PORT,
      )
    expect(port('65535', 1)).toBe(65535)
    expect(port('65535', 2)).toBe(1160)
    expect(port('70000', 1)).toBeGreaterThanOrEqual(45_000)
    expect(port('80', 1)).toBeGreaterThanOrEqual(45_000)
  })

  it('drops an all-protocol DEBUG, adds browser lifecycle debug after a hang and picks a port', () => {
    const env = makeAttemptEnv('ui', { DEBUG: 'pw:protocol' }, 1, '/repo', true)
    expect(env.DEBUG).toBe(
      '-pw:protocol*,vitest:browser:playwright,vitest:browser:api,pw:browser*,vite:deps',
    )
    const port = Number(env.VITEST_STORYBOOK_BROWSER_API_PORT)
    expect(port).toBeGreaterThanOrEqual(45_000)
    expect(port).toBeLessThan(55_000)
  })
})

describe('storybookBrowserAttemptCacheDir', () => {
  it('lives under node_modules locally and the runner temp directory in CI', () => {
    expect(storybookBrowserAttemptCacheDir({}, 2, '/r')).toBe(
      '/r/node_modules/.vite/storybook-browser-attempt-2',
    )
    expect(storybookBrowserAttemptCacheDir({ RUNNER_TEMP: '/rt' }, 2, '/r')).toBe(
      '/rt/vite-storybook-browser-attempt-2',
    )
    expect(storybookBrowserAttemptCacheDir({ CI: '1', TMPDIR: '/t' }, 1, '/r')).toBe(
      '/t/vite-storybook-browser-attempt-1',
    )
    expect(storybookBrowserAttemptCacheDir({ CI: '1' }, 1, '/r')).toMatch(
      /vite-storybook-browser-attempt-1$/,
    )
  })
})

describe('parseStorybookBrowserRunnerArgs', () => {
  it('requires a project', () => {
    expect(() => parseStorybookBrowserRunnerArgs([])).toThrow('--project <name> is required')
  })

  it('parses every flag and the argv after --', () => {
    expect(
      parseStorybookBrowserRunnerArgs([
        '--project',
        'ui',
        '--command',
        'npx',
        '--completion-file',
        'done.json',
        '--coverage-arg=--coverage',
        '--coverage-arg=--reporter=lcov',
        '--env-prefix',
        'SB',
        '--optimize-deps-config',
        'o.mts',
        '--progress-prefix',
        '[p]',
        '--result-file',
        'a',
        '--result-file',
        'b',
        '--',
        'vitest',
        'run',
        '--bail=3',
      ]),
    ).toEqual({
      args: ['vitest', 'run', '--bail=3'],
      command: 'npx',
      completionFile: 'done.json',
      coverageArgs: ['--coverage', '--reporter=lcov'],
      envPrefix: 'SB',
      optimizeDepsConfigPath: 'o.mts',
      progressPrefix: '[p]',
      projectName: 'ui',
      resultFiles: ['a', 'b'],
    })
  })

  it('returns only the project when nothing else is given', () => {
    expect(parseStorybookBrowserRunnerArgs(['--project', 'ui'])).toEqual({ projectName: 'ui' })
  })

  it('rejects empty values and flag-like values', () => {
    expect(() => parseStorybookBrowserRunnerArgs(['--project='])).toThrow('--project requires')
    expect(() => parseStorybookBrowserRunnerArgs(['--project', 'ui', '--command='])).toThrow(
      '--command requires a value',
    )
    expect(() => parseStorybookBrowserRunnerArgs(['--project', 'ui', '--result-file=-x'])).toThrow(
      '--result-file requires a value',
    )
  })
})
