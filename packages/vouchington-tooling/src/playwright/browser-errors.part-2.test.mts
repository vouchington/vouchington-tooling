import {
  MockBrowserContext,
  createRequest,
  createPage,
  createTestInfo,
} from './browser-issue-monitor.test-helpers.mts'

import { describe, expect, it } from 'vitest'

import type { BrowserContext, ConsoleMessage } from '@playwright/test'

import { BrowserIssueMonitor } from './browser-errors.mts'
import { matchesAllowlist } from './browser-issue-records.mts'

function createConsoleMessage(
  overrides: Partial<{
    text: string
    type: string
  }> = {},
) {
  const { text = 'Assertion failed: expected hydrated menu state', type = 'assert' } = overrides

  return {
    location: () => ({
      columnNumber: 7,
      lineNumber: 13,
      url: 'http://localhost:8787/_next/static/chunks/app.js',
    }),
    page: () => createPage(),
    text: () => text,
    type: () => type,
  } as unknown as ConsoleMessage
}

describe('BrowserIssueMonitor', () => {
  it('fails on failed browser console assertions', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit('console', createConsoleMessage() as never)

    await expect(monitor.assertNoIssues()).rejects.toThrow(/consoleerror/)
    expect(attachments[0]?.body.toString()).toContain(
      'Assertion failed: expected hydrated menu state',
    )
  })

  it('ignores allowlisted request failures with a reason', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo, {
      allowlist: [
        {
          pattern: /^https:\/\/www\.google-analytics\.com\/collect$/,
          reason: 'External analytics endpoint is disabled in Playwright',
          type: 'requestfailed',
        },
      ],
    })
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'requestfailed',
      createRequest({ url: 'https://www.google-analytics.com/collect' }) as never,
    )

    await expect(monitor.assertNoIssues()).resolves.toBeUndefined()
  })

  it('does not allowlist issues with a different type', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo, {
      allowlist: [
        {
          pattern: /render failed/,
          reason: 'Only request failures are expected for this pattern',
          type: 'requestfailed',
        },
      ],
    })
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit('weberror', {
      error: () => new Error('render failed'),
      page: () => createPage(),
    } as never)

    await expect(monitor.assertNoIssues()).rejects.toThrow(/Unhandled browser issue detected/)
  })

  it('does not allowlist web errors by stack trace content', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo, {
      allowlist: [
        {
          pattern: /expected-stack-frame/,
          reason: 'Stack traces are not stable allowlist keys',
          type: 'weberror',
        },
      ],
    })
    monitor.monitorContext(context as unknown as BrowserContext)

    const error = new Error('message does not match')
    error.stack = 'Error: message does not match\n    at expected-stack-frame'
    context.emit('weberror', {
      error: () => error,
      page: () => createPage(),
    } as never)

    await expect(monitor.assertNoIssues()).rejects.toThrow(/Unhandled browser issue detected/)
  })

  it('requires allowlist reasons and specific patterns', () => {
    const { testInfo } = createTestInfo()

    expect(
      () =>
        new BrowserIssueMonitor(testInfo, {
          allowlist: [{ pattern: /expected/, reason: '', type: 'weberror' }],
        }),
    ).toThrow(/must include a reason/)

    expect(
      () =>
        new BrowserIssueMonitor(testInfo, {
          allowlist: [{ pattern: /.*/, reason: 'Too broad', type: 'requestfailed' }],
        }),
    ).toThrow(/too broad/)

    expect(
      () =>
        new BrowserIssueMonitor(testInfo, {
          allowlist: [{ pattern: /.+/, reason: 'Too broad', type: 'requestfailed' }],
        }),
    ).toThrow(/too broad/)

    expect(
      () =>
        new BrowserIssueMonitor(testInfo, {
          allowlist: [{ pattern: /^.*$/, reason: 'Too broad', type: 'requestfailed' }],
        }),
    ).toThrow(/too broad/)

    expect(
      () =>
        new BrowserIssueMonitor(testInfo, {
          allowlist: [{ pattern: /^[\s\S]*$/, reason: 'Too broad', type: 'weberror' }],
        }),
    ).toThrow(/too broad/)
  })

  it('does not record issues after dispose', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)
    monitor.monitorContext(context as unknown as BrowserContext)
    expect(context.listeners.get('weberror')?.size).toBe(1)

    monitor.dispose()
    context.emit('weberror', { error: () => new Error('late'), page: () => null } as never)

    await expect(monitor.assertNoIssues()).resolves.toBeUndefined()
  })

  it('handles unavailable page and frame metadata', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit('weberror', { error: () => new Error('no page'), page: () => null } as never)
    context.emit('requestfailed', createRequest({ failureText: null, frameThrows: true }) as never)

    await expect(monitor.assertNoIssues()).rejects.toThrow(/2/)
    const body = attachments[0]?.body.toString()
    expect(body).toContain('(no page)')
    expect(body).toContain('(no failure text)')
    expect(body).toContain('(frame URL unavailable)')
  })

  it('matches a web error allowlist when the error object is missing', () => {
    expect(
      matchesAllowlist(
        {
          error: undefined as unknown as Error,
          pageUrl: 'http://127.0.0.1/missing',
          type: 'weberror',
        },
        [{ pattern: /127\.0\.0\.1/, reason: 'local web error', type: 'weberror' }],
      ),
    ).toBe(true)
  })
})
