import { describe, expect, it, vi } from 'vitest'
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { createTestInfo } from './browser-issue-monitor.test-helpers.mts'
import { blockedExternalRequestFailureAllowlist } from './blocked-external-network.mts'
import { createBrowserErrorsFixture, withMonitoredPage } from './browser-test.mts'

function createContext() {
  const routes: RegExp[] = []
  const listeners = new Map<string, Set<(...args: never[]) => void>>()
  const context = {
    off(event: string, listener: (...args: never[]) => void) {
      listeners.get(event)?.delete(listener)
    },
    on(event: string, listener: (...args: never[]) => void) {
      const current = listeners.get(event) ?? new Set()
      current.add(listener)
      listeners.set(event, current)
    },
    pages: () => [],
    route: async (pattern: RegExp) => {
      routes.push(pattern)
    },
  }
  return { context: context as unknown as BrowserContext, routes }
}

function testInfoWith(status: string, expectedStatus = 'passed') {
  const { attach, testInfo } = createTestInfo()
  return {
    attach,
    testInfo: Object.assign(testInfo, { expectedStatus, status }) as TestInfo,
  }
}

describe('browser test fixture', () => {
  it('asserts a clean run and checks the caller timeout', async () => {
    const { context, routes } = createContext()
    const { attach, testInfo } = testInfoWith('passed')
    const assertTimeout = vi.fn<(timeout: number, label: string) => void>()
    const fixture = createBrowserErrorsFixture({ assertTimeout })

    await fixture({ context }, async () => undefined, testInfo)

    expect(assertTimeout).toHaveBeenCalledWith(
      testInfo.timeout,
      'Playwright effective test timeout',
    )
    expect(routes.length).toBeGreaterThan(0)
    expect(attach).not.toHaveBeenCalled()
  })

  it('attaches issues when the test already failed', async () => {
    const { context } = createContext()
    const { attach, testInfo } = testInfoWith('failed')
    const fixture = createBrowserErrorsFixture()

    await fixture(
      { context },
      async (monitor) => {
        monitor.monitorContext(context)
      },
      testInfo,
    )

    expect(attach).not.toHaveBeenCalled()
  })

  it('attaches issues and rethrows when the callback fails', async () => {
    const { context } = createContext()
    const { testInfo } = testInfoWith('passed')
    const fixture = createBrowserErrorsFixture()

    await expect(
      fixture(
        { context },
        async () => {
          throw new Error('callback failed')
        },
        testInfo,
      ),
    ).rejects.toThrow('callback failed')
  })

  it('returns the monitored page result', async () => {
    const { context, routes } = createContext()
    const close = vi.fn<(...args: Array<never>) => unknown>(async () => undefined)
    const page = {
      close,
      context: () => context,
    } as unknown as Page
    const browser = {
      newPage: async () => page,
    } as unknown as Browser
    const { testInfo } = testInfoWith('passed')

    await expect(
      withMonitoredPage(browser, testInfo, async () => 'ok', {
        rules: [],
        warningPattern: /caller-warning/,
      }),
    ).resolves.toBe('ok')
    expect(close).toHaveBeenCalled()
    expect(routes).toHaveLength(0)
  })

  it('checks the caller timeout and opens no page when the allowlist is invalid', async () => {
    const assertTimeout = vi.fn<(timeout: number, label: string) => void>()
    const newPage = vi.fn<() => Promise<Page>>()
    const { testInfo } = testInfoWith('passed')

    await expect(
      withMonitoredPage({ newPage } as unknown as Browser, testInfo, async () => 'ok', {
        allowlist: [{ pattern: /.*/, reason: 'Too broad', type: 'requestfailed' }],
        assertTimeout,
      }),
    ).rejects.toThrow(/too broad/)
    expect(assertTimeout).toHaveBeenCalledWith(
      testInfo.timeout,
      'Playwright effective test timeout',
    )
    expect(newPage).not.toHaveBeenCalled()
  })

  it('derives the default allowlist from the active rules', async () => {
    const { context } = createContext()
    const page = { close: async () => undefined, context: () => context } as unknown as Page
    const { testInfo } = testInfoWith('passed')

    await expect(
      withMonitoredPage(
        { newPage: async () => page } as unknown as Browser,
        testInfo,
        async () => 1,
        {
          rules: [],
        },
      ),
    ).resolves.toBe(1)
    expect(blockedExternalRequestFailureAllowlist([], [])).toEqual([])
  })

  it('still closes the page when close rejects', async () => {
    const { context } = createContext()
    const close = vi.fn<(...args: Array<never>) => unknown>(async () => {
      throw new Error('already closed')
    })
    const page = {
      close,
      context: () => context,
    } as unknown as Page
    const { testInfo } = testInfoWith('passed')

    await expect(
      withMonitoredPage(
        { newPage: async () => page } as unknown as Browser,
        testInfo,
        async () => 'ok',
      ),
    ).resolves.toBe('ok')
  })

  it('attaches issues when the monitored page callback fails', async () => {
    const { context } = createContext()
    const close = vi.fn<(...args: Array<never>) => unknown>(async () => undefined)
    const page = {
      close,
      context: () => context,
    } as unknown as Page
    const { testInfo } = testInfoWith('passed')

    await expect(
      withMonitoredPage({ newPage: async () => page } as unknown as Browser, testInfo, async () => {
        throw new Error('page failed')
      }),
    ).rejects.toThrow('page failed')
    expect(close).toHaveBeenCalled()
  })
})
