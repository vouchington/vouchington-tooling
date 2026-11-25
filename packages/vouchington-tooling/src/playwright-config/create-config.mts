import type { PlaywrightTestConfig, ReporterDescription } from '@playwright/test'
import { parseMaxWorkers } from './config-helpers.mts'
import { createPlaywrightTimeoutGuard } from './test-timeout.mts'
import type { PlaywrightTimeoutGuard } from './test-timeout.mts'
import { createReporter } from './web-server-command.mts'

export const DEFAULT_PLAYWRIGHT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

export type CreatePlaywrightConfigOptions = {
  testDir: string
  projects?: PlaywrightTestConfig['projects']
  /** Base URL for `use.baseURL`. Overridden if `use.baseURL` is also specified. */
  baseURL?: string
  /** Per-test timeout in milliseconds. Defaults to `timeoutGuard.maxTimeoutMs` (30,000 ms). */
  timeout?: number
  /** Timeout guard used to validate config and project timeouts. */
  timeoutGuard?: Pick<PlaywrightTimeoutGuard, 'maxTimeoutMs' | 'validateConfigTimeouts'>
  /** Default JUnit report path used in CI when `PLAYWRIGHT_JUNIT_OUTPUT_FILE` is unset. */
  junitOutputFile?: string
  /** Whether running in CI. Defaults to `Boolean(env.CI)`. */
  ci?: boolean
  /** Environment read for `CI`, `PLAYWRIGHT_MAX_WORKERS`, and `PLAYWRIGHT_JUNIT_OUTPUT_FILE`. */
  env?: NodeJS.ProcessEnv
  /** Explicit worker count or percentage. Overrides `PLAYWRIGHT_MAX_WORKERS`. */
  workers?: number | string
  /** Fallback workers when `workers` and `PLAYWRIGHT_MAX_WORKERS` are unset (`3` in CI, `'30%'` locally). */
  defaultWorkers?: number | string
  fullyParallel?: boolean
  forbidOnly?: boolean
  retries?: number
  maxFailures?: number
  globalSetup?: PlaywrightTestConfig['globalSetup']
  globalTeardown?: PlaywrightTestConfig['globalTeardown']
  testMatch?: PlaywrightTestConfig['testMatch']
  /** Explicit reporter override. Replaces the built-in `createReporter` selection. */
  reporter?: PlaywrightTestConfig['reporter']
  /** Extra reporters appended to the built-in `createReporter` list. */
  extraReporters?: ReporterDescription[]
  expect?: PlaywrightTestConfig['expect']
  use?: PlaywrightTestConfig['use']
  webServer?: PlaywrightTestConfig['webServer']
}

export function createPlaywrightConfig(
  options: CreatePlaywrightConfigOptions,
): PlaywrightTestConfig {
  const env = options.env ?? process.env
  const ci = options.ci ?? Boolean(env['CI'])
  const guard = options.timeoutGuard ?? createPlaywrightTimeoutGuard()
  const timeout = options.timeout ?? guard.maxTimeoutMs
  const defaultWorkers = options.defaultWorkers ?? (ci ? 3 : '30%')
  const workers = options.workers ?? parseMaxWorkers(env['PLAYWRIGHT_MAX_WORKERS'], defaultWorkers)
  const reporter =
    options.reporter ??
    createReporter({
      junitOutputFile: options.junitOutputFile ?? 'test-report.junit.xml',
      ci,
      ...(options.extraReporters !== undefined ? { extraReporters: options.extraReporters } : {}),
      env,
    })
  const maxFailures = options.maxFailures ?? (ci ? 3 : undefined)

  const config: PlaywrightTestConfig = {
    testDir: options.testDir,
    fullyParallel: options.fullyParallel ?? true,
    workers,
    forbidOnly: options.forbidOnly ?? ci,
    retries: options.retries ?? (ci ? 1 : 0),
    reporter,
    timeout,
    expect: { timeout: 10_000, ...options.expect },
    use: {
      ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
      testIdAttribute: 'data-pw',
      ignoreHTTPSErrors: true,
      actionTimeout: 10_000,
      navigationTimeout: 15_000,
      trace: 'on-first-retry',
      ...options.use,
    },
    ...(maxFailures !== undefined ? { maxFailures } : {}),
    ...(options.globalSetup !== undefined ? { globalSetup: options.globalSetup } : {}),
    ...(options.globalTeardown !== undefined ? { globalTeardown: options.globalTeardown } : {}),
    ...(options.testMatch !== undefined ? { testMatch: options.testMatch } : {}),
    ...(options.projects !== undefined ? { projects: options.projects } : {}),
    ...(options.webServer !== undefined ? { webServer: options.webServer } : {}),
  }

  return guard.validateConfigTimeouts(config)
}
