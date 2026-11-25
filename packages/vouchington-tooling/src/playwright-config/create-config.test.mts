import { describe, expect, it } from 'vitest'
import {
  createPlaywrightConfig,
  createPlaywrightTimeoutGuard,
  DEFAULT_PLAYWRIGHT_TEST_TIMEOUT_MS,
  DEFAULT_PLAYWRIGHT_USER_AGENT,
} from './index.mts'

describe('createPlaywrightConfig', () => {
  it('applies local defaults and validates timeouts with the default guard', () => {
    const config = createPlaywrightConfig({
      testDir: './e2e/tests',
      baseURL: 'http://localhost:8787',
      env: {},
    })

    expect(config).toMatchObject({
      testDir: './e2e/tests',
      fullyParallel: true,
      workers: '30%',
      forbidOnly: false,
      retries: 0,
      reporter: [['html', { open: 'never' }]],
      timeout: DEFAULT_PLAYWRIGHT_TEST_TIMEOUT_MS,
      expect: { timeout: 10_000 },
      use: {
        baseURL: 'http://localhost:8787',
        testIdAttribute: 'data-pw',
        ignoreHTTPSErrors: true,
        actionTimeout: 10_000,
        navigationTimeout: 15_000,
        trace: 'on-first-retry',
      },
    })
    expect(config.maxFailures).toBeUndefined()
    expect(config.globalSetup).toBeUndefined()
    expect(config.projects).toBeUndefined()
    expect(config.webServer).toBeUndefined()
    expect(DEFAULT_PLAYWRIGHT_USER_AGENT).toContain('Chrome/')
  })

  it('applies CI defaults and respects injected env overrides', () => {
    const config = createPlaywrightConfig({
      testDir: './e2e/tests',
      junitOutputFile: 'results.xml',
      extraReporters: [['dot']],
      env: {
        CI: '1',
        PLAYWRIGHT_MAX_WORKERS: '4',
        PLAYWRIGHT_JUNIT_OUTPUT_FILE: 'ci-results.xml',
      },
    })

    expect(config.workers).toBe(4)
    expect(config.forbidOnly).toBe(true)
    expect(config.retries).toBe(1)
    expect(config.maxFailures).toBe(3)
    expect(config.reporter).toEqual([
      ['github'],
      ['junit', { outputFile: 'ci-results.xml' }],
      [expect.stringMatching(/test-lifecycle-reporter/), { failOnSkippedTests: true }],
      ['dot'],
    ])
  })

  it('uses CI worker count 3 when PLAYWRIGHT_MAX_WORKERS is unset', () => {
    const config = createPlaywrightConfig({
      testDir: './e2e/tests',
      ci: true,
      env: {},
    })
    expect(config.workers).toBe(3)
    expect(config.reporter).toEqual([
      ['github'],
      ['junit', { outputFile: 'test-report.junit.xml' }],
      [expect.stringMatching(/test-lifecycle-reporter/), { failOnSkippedTests: true }],
    ])
  })

  it('allows overriding every caller-owned option including projects, use, and webServer', () => {
    const webServer = {
      command: 'node server.mjs',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
    }
    const config = createPlaywrightConfig({
      testDir: './e2e/credentialed',
      baseURL: 'http://localhost:8787',
      ci: true,
      env: {},
      workers: 2,
      fullyParallel: false,
      forbidOnly: false,
      retries: 0,
      maxFailures: 1,
      timeout: 20_000,
      globalSetup: './setup.mts',
      globalTeardown: './teardown.mts',
      testMatch: '**/*.spec.mts',
      reporter: [['list']],
      expect: { timeout: 5_000 },
      use: {
        baseURL: 'https://localhost:8787',
        testIdAttribute: 'data-testid',
        storageState: {
          cookies: [],
          origins: [
            {
              origin: 'https://localhost:8787',
              localStorage: [{ name: 'consent', value: 'essential' }],
            },
          ],
        },
      },
      projects: [{ name: 'chromium', timeout: 15_000 }],
      webServer,
    })

    expect(config).toMatchObject({
      testDir: './e2e/credentialed',
      fullyParallel: false,
      workers: 2,
      forbidOnly: false,
      retries: 0,
      maxFailures: 1,
      timeout: 20_000,
      globalSetup: './setup.mts',
      globalTeardown: './teardown.mts',
      testMatch: '**/*.spec.mts',
      reporter: [['list']],
      expect: { timeout: 5_000 },
      use: {
        baseURL: 'https://localhost:8787',
        testIdAttribute: 'data-testid',
        storageState: {
          cookies: [],
          origins: [
            {
              origin: 'https://localhost:8787',
              localStorage: [{ name: 'consent', value: 'essential' }],
            },
          ],
        },
      },
      projects: [{ name: 'chromium', timeout: 15_000 }],
      webServer,
    })
  })

  it('uses custom defaultWorkers and falls back to process.env when env is omitted', () => {
    const config = createPlaywrightConfig({
      testDir: './e2e',
      ci: false,
      defaultWorkers: 2,
    })
    expect(config.workers).toBe(2)
  })

  it('validates test and project timeouts with the supplied timeoutGuard', () => {
    const timeoutGuard = createPlaywrightTimeoutGuard({ maxTimeoutMs: 15_000 })

    expect(createPlaywrightConfig({ testDir: './e2e', env: {}, timeoutGuard }).timeout).toBe(15_000)

    expect(() =>
      createPlaywrightConfig({ testDir: './e2e', env: {}, timeoutGuard, timeout: 15_001 }),
    ).toThrow('Playwright test timeout must be a positive finite number at most 15,000 ms')

    expect(() =>
      createPlaywrightConfig({
        testDir: './e2e',
        env: {},
        timeoutGuard,
        projects: [{ name: 'chromium', timeout: 20_000 }],
      }),
    ).toThrow(
      'Playwright project chromium timeout must be a positive finite number at most 15,000 ms',
    )
  })
})
