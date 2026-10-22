import {
  MockBrowserContext,
  createPage,
  createTestInfo,
} from './browser-issue-monitor.test-helpers.mts'

import { describe, expect, it } from 'vitest'
import type { BrowserContext, ConsoleMessage, Page } from '@playwright/test'
import { BrowserIssueMonitor } from './browser-errors.mts'

function createConsoleMessage(
  overrides: Partial<{
    columnNumber: number
    lineNumber: number
    page: null | Page
    text: string
    type: string
    url: string
  }> = {},
) {
  const {
    columnNumber = 7,
    lineNumber = 13,
    page = createPage(),
    text = 'client render logged an error',
    type = 'error',
    url = 'http://localhost:8787/_next/static/chunks/app.js',
  } = overrides

  return {
    location: () => ({ columnNumber, lineNumber, url }),
    page: () => page,
    text: () => text,
    type: () => type,
  } as unknown as ConsoleMessage
}

describe('BrowserIssueMonitor console errors', () => {
  it('fails with console error context', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({
        text: 'Hydration failed because the initial UI does not match',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/consoleerror/)
    const body = attachments[0]?.body.toString()
    expect(body).toContain('Hydration failed because the initial UI does not match')
    expect(body).toContain('http://localhost:8787/path')
    expect(body).toContain('app.js:13:7')
  })

  it('ignores non-error console messages', async () => {
    const { attach, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit('console', createConsoleMessage({ type: 'warning' }) as never)
    context.emit('console', createConsoleMessage({ type: 'log' }) as never)

    await expect(monitor.assertNoIssues()).resolves.toBeUndefined()
    expect(attach).not.toHaveBeenCalled()
  })

  it('fails on React render warnings that indicate hydration problems', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({
        text: 'Warning: Text content does not match server-rendered HTML.',
        type: 'warning',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/consoleerror/)
    const body = attachments[0]?.body.toString()
    expect(body).toContain('[consoleerror]')
    expect(body).toContain('Text content does not match server-rendered HTML')
  })

  it('fails on legacy React text mismatch warnings', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({
        text: 'Warning: Text content did not match. Server: "One" Client: "Two"',
        type: 'warning',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/consoleerror/)
    const body = attachments[0]?.body.toString()
    expect(body).toContain('[consoleerror]')
    expect(body).toContain('Text content did not match')
  })

  it('ignores unrelated warnings that contain did not match text', async () => {
    const { attach, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({
        text: 'Search filters did not match any saved query.',
        type: 'warning',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).resolves.toBeUndefined()
    expect(attach).not.toHaveBeenCalled()
  })

  it('ignores allowlisted console errors with a reason', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo, {
      allowlist: [
        {
          pattern: /known third-party widget noise/,
          reason: 'The third-party widget logs in test mode but does not affect app behavior',
          type: 'consoleerror',
        },
      ],
    })
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({ text: 'known third-party widget noise' }) as never,
    )

    await expect(monitor.assertNoIssues()).resolves.toBeUndefined()
  })

  it('ignores browser-synthesized "Failed to load resource:" errors from 4xx responses', async () => {
    const { attach, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({
        columnNumber: 0,
        lineNumber: 0,
        text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
        url: 'http://localhost:8787/api/v1/posts/missing',
      }) as never,
    )
    context.emit(
      'console',
      createConsoleMessage({
        columnNumber: 0,
        lineNumber: 0,
        text: 'Failed to load resource: the server responded with a status of 403 (Forbidden)',
        url: 'http://localhost:8787/api/v1/topic-recommendations',
      }) as never,
    )
    context.emit(
      'console',
      createConsoleMessage({
        columnNumber: 0,
        lineNumber: 0,
        text: 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
        url: 'http://localhost:8787/api/v1/tags',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).resolves.toBeUndefined()
    expect(attach).not.toHaveBeenCalled()
  })

  it('still fails on "Failed to load resource:" with a real JS source location', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({
        columnNumber: 5,
        lineNumber: 10,
        text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
        url: 'http://localhost:8787/_next/static/chunks/app.js',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/consoleerror/)
  })

  it('still fails when a zero-location resource error points at a script', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({
        columnNumber: 0,
        lineNumber: 0,
        text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
        url: 'http://localhost:8787/_next/static/chunks/app.js',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/consoleerror/)
  })

  it('fails on React script tag render warnings', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({
        text: 'Encountered a script tag while rendering React component. React does not render script elements as part of hydration because they may manipulate the DOM in ways that are not compatible with React. Try moving the script to a location that does not conflict with React hydration.',
        type: 'warning',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/consoleerror/)
    expect(attachments[0]?.body.toString()).toMatch(/Encountered a script tag/)
  })

  it('disposes console listeners and handles unavailable metadata', async () => {
    const { attachments, testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo)
    monitor.monitorContext(context as unknown as BrowserContext)
    monitor.monitorContext(context as unknown as BrowserContext)
    expect(context.listeners.get('console')?.size).toBe(1)

    monitor.dispose()
    context.emit('console', createConsoleMessage({ text: 'late console error' }) as never)
    await expect(monitor.assertNoIssues()).resolves.toBeUndefined()

    monitor.monitorContext(context as unknown as BrowserContext)
    context.emit(
      'console',
      createConsoleMessage({
        columnNumber: 0,
        lineNumber: 0,
        page: null,
        text: 'console metadata unavailable',
        url: '',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/1/)
    const body = attachments[0]?.body.toString()
    expect(body).toContain('(no page)')
    expect(body).toContain('Location: 0:0')
  })

  it('uses a caller warning pattern when one is provided', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo, { warningPattern: /caller-warning/ })
    monitor.monitorContext(context as unknown as BrowserContext)

    context.emit(
      'console',
      createConsoleMessage({ text: 'caller-warning: rendered twice', type: 'warning' }) as never,
    )
    context.emit(
      'console',
      createConsoleMessage({
        text: 'Warning: Text content does not match server-rendered HTML.',
        type: 'warning',
      }) as never,
    )

    await expect(monitor.assertNoIssues()).rejects.toThrow(/1/)
  })

  it('records consecutive matches of a global warning pattern', async () => {
    const { testInfo } = createTestInfo()
    const context = new MockBrowserContext()
    const monitor = new BrowserIssueMonitor(testInfo, { warningPattern: /caller-warning/g })
    monitor.monitorContext(context as unknown as BrowserContext)

    for (let count = 0; count < 2; count += 1) {
      context.emit(
        'console',
        createConsoleMessage({ text: 'caller-warning', type: 'warning' }) as never,
      )
    }

    await expect(monitor.assertNoIssues()).rejects.toThrow(/2/)
  })
})
