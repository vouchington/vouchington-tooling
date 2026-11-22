import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assetHostResolverRule,
  createReporter,
  definedEnv,
  nodeServerCommand,
  originOrFallback,
  parseMaxWorkers,
  runnablePlaywrightTest,
  shellQuote,
  withNodeOption,
  withOptionalLaunchOptionArg,
  withOtelNodeOptions,
} from './index.mts'
import type { TestType } from '@playwright/test'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('withNodeOption', () => {
  it('appends a missing option and trims input', () => {
    expect(withNodeOption(' --a ', '--b')).toBe('--a --b')
    expect(withNodeOption(undefined, '--b')).toBe('--b')
  })

  it('keeps an existing exact option or singleton prefix', () => {
    expect(withNodeOption('--b --a', '--b')).toBe('--b --a')
    expect(withNodeOption('--import=x', '--import=y', '--import=')).toBe('--import=x')
    expect(withNodeOption(undefined, '--x', '--x=')).toBe('--x')
  })

  it('escapes regex characters in the option', () => {
    expect(withNodeOption('--a.b', '--aXb')).toBe('--a.b --aXb')
  })
})

describe('parseMaxWorkers', () => {
  it('parses counts and percentages and falls back with a warning', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(parseMaxWorkers(undefined, 2)).toBe(2)
    expect(parseMaxWorkers('4', 2)).toBe(4)
    expect(parseMaxWorkers('50%', 2)).toBe('50%')
    expect(parseMaxWorkers('0', 2)).toBe(2)
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Invalid PLAYWRIGHT_MAX_WORKERS'))
  })
})

describe('origin helpers', () => {
  it('derives origins with a fallback', () => {
    expect(originOrFallback('https://a.test/x?y', 'f')).toBe('https://a.test')
    expect(originOrFallback('nope', 'f')).toBe('f')
  })

  it('maps only a localhost asset prefix to the web port', () => {
    expect(assetHostResolverRule('http://localhost/assets', '3000')).toBe(
      '--host-resolver-rules=MAP localhost:80 127.0.0.1:3000',
    )
    expect(assetHostResolverRule('https://cdn.test', '3000')).toBeUndefined()
    expect(assetHostResolverRule(undefined, '3000')).toBeUndefined()
  })

  it('adds a launch arg without losing existing ones', () => {
    expect(withOptionalLaunchOptionArg({ a: 1 }, 'ua')).toEqual({ a: 1, userAgent: 'ua' })
    expect(withOptionalLaunchOptionArg({ launchOptions: { args: ['x'] } }, 'ua', 'y')).toEqual({
      launchOptions: { args: ['x', 'y'] },
      userAgent: 'ua',
    })
    expect(withOptionalLaunchOptionArg({}, 'ua', 'y').launchOptions).toEqual({ args: ['y'] })
  })
})

describe('server commands', () => {
  it('quotes and filters env', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`)
    expect(definedEnv({ A: '1', B: undefined })).toEqual({ A: '1' })
  })

  it('wraps a node command with logging and optional OpenTelemetry', () => {
    const plain = nodeServerCommand({
      name: 'api',
      serviceName: 'svc',
      command: 'node serve.mts',
      logDir: '/logs',
    })
    expect(plain).toContain('OTEL_SERVICE_NAME=svc node serve.mts')
    expect(plain).not.toContain('--import')
    const traced = nodeServerCommand({
      name: 'api',
      serviceName: 'svc',
      command: 'node serve.mts',
      logDir: '/logs',
      otelPreload: '/otel.mts',
    })
    expect(traced).toContain('OTEL_LOGS_EXPORTER=otlp')
    expect(traced).toContain('node --import')
    expect(traced).toContain('/otel.mts')
  })

  it('adds the preload to NODE_OPTIONS only when enabled', () => {
    expect(withOtelNodeOptions('--x', undefined)).toBe('--x')
    expect(withOtelNodeOptions('--x', '/otel.mts')).toBe('--x --import "/otel.mts"')
  })
})

describe('createReporter', () => {
  it('uses html locally and appends extra reporters', () => {
    expect(createReporter({ junitOutputFile: 'j.xml', ci: false })).toEqual([
      ['html', { open: 'never' }],
    ])
    expect(
      createReporter({ junitOutputFile: 'j.xml', ci: false, extraReporters: [['dot']] }),
    ).toEqual([['html', { open: 'never' }], ['dot']])
  })

  it('uses github, junit, and the lifecycle reporter in CI', () => {
    const reporters = createReporter({
      junitOutputFile: 'j.xml',
      ci: true,
      extraReporters: [['dot']],
    })
    expect(reporters.map((entry) => entry[0])).toEqual([
      'github',
      'junit',
      expect.stringMatching(/test-lifecycle-reporter/),
      'dot',
    ])
    expect(reporters[1]).toEqual(['junit', { outputFile: 'j.xml' }])
    vi.stubEnv('PLAYWRIGHT_JUNIT_OUTPUT_FILE', 'env.xml')
    expect(createReporter({ junitOutputFile: 'j.xml', ci: true })[1]).toEqual([
      'junit',
      { outputFile: 'env.xml' },
    ])
  })
})

describe('runnablePlaywrightTest', () => {
  it('returns the same test object', () => {
    const source = {} as TestType<object, object>
    expect(runnablePlaywrightTest(source)).toBe(source)
  })
})
