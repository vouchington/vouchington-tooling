import { afterEach, describe, expect, it, vi } from 'vitest'

import { createGhApi, createGhRunner } from './gh-api.mts'
import { installFakeGh } from './run-context.test-helpers.mts'

describe('createGhApi', () => {
  it('prefixes api, returns stdout, and retries transport errors with backoff', async () => {
    const run = vi
      .fn<(args: string[]) => Promise<string>>()
      .mockRejectedValueOnce(new Error('read: ECONNRESET'))
      .mockRejectedValueOnce(Object.assign(new Error('failed'), { stderr: 'HTTP 503' }))
      .mockResolvedValue('ok')
    const sleep = vi.fn(async () => undefined)
    const warn = vi.fn()

    await expect(createGhApi({ run, sleep, warn }).call(['repos/a/b'])).resolves.toBe('ok')

    expect(run).toHaveBeenCalledWith(['api', 'repos/a/b'])
    expect(sleep.mock.calls).toEqual([[1000], [2000]])
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls.join('')).not.toContain('503')
  })

  it('rethrows non-retryable errors and exhausted retries immediately', async () => {
    const fatal = vi.fn().mockRejectedValue(new Error('HTTP 404'))
    await expect(createGhApi({ run: fatal }).call([])).rejects.toThrow('HTTP 404')
    expect(fatal).toHaveBeenCalledTimes(1)

    const flaky = vi.fn().mockRejectedValue('ETIMEDOUT')
    const api = createGhApi({
      run: flaky,
      attempts: 2,
      sleep: async () => undefined,
      warn: () => {},
    })
    await expect(api.call([])).rejects.toBe('ETIMEDOUT')
    expect(flaky).toHaveBeenCalledTimes(2)
  })

  it('honors caller-supplied retryable markers', async () => {
    const api = createGhApi({ run: async () => '', retryableMarkers: ['custom'] })
    expect(api.isRetryable(new Error('a custom failure'))).toBe(true)
    expect(api.isRetryable(new Error('ECONNRESET'))).toBe(false)
    expect(api.isRetryable(null)).toBe(false)
  })

  it('rejects an invalid attempt count', () => {
    expect(() => createGhApi({ attempts: 0 })).toThrow('Invalid gh api retry attempts: 0')
  })

  it('sleeps and warns through the real defaults', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const run = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue('done')
    const result = createGhApi({ run }).call([])
    await vi.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toBe('done')
    expect(error).toHaveBeenCalledOnce()
    vi.useRealTimers()
    error.mockRestore()
  })
})

describe('createGhRunner', () => {
  let restore: (() => void) | undefined
  afterEach(() => restore?.())

  it('runs gh with a named token variable exposed as GH_TOKEN and no forced color', async () => {
    restore = installFakeGh('echo "$*|$GH_TOKEN|${CLICOLOR_FORCE:-unset}"')
    process.env.CLICOLOR_FORCE = '1'
    process.env.TEST_TOKEN_SOURCE = 'secret-token'
    try {
      await expect(createGhRunner('TEST_TOKEN_SOURCE')(['api', 'x'])).resolves.toBe(
        'api x|secret-token|unset\n',
      )
    } finally {
      delete process.env.CLICOLOR_FORCE
      delete process.env.TEST_TOKEN_SOURCE
    }
  })

  it('leaves GH_TOKEN alone when no token variable is named or set', async () => {
    restore = installFakeGh('echo "${GH_TOKEN:-none}"')
    await expect(createGhRunner()(['x'])).resolves.toBe('none\n')
    await expect(createGhRunner('MISSING_TOKEN_SOURCE')(['x'])).resolves.toBe('none\n')
  })
})
